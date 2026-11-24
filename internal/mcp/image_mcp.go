package mcp

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/LeonEthan/molly-design/internal/imaging"
	"github.com/LeonEthan/molly-design/internal/security"
)

const (
	ProtocolOpenAIImages = "openai-images"
	ProtocolDashScope    = "dashscope"

	OpenAIGenerationsPath = "/images/generations"
	OpenAIEditsPath       = "/images/edits"
	DashScopePath         = "/services/aigc/multimodal-generation/generation"

	DefaultImageTimeout = 180 * time.Second
	MaxResponseBytes    = 64 << 20
	MaxEditTotalBytes   = 64 << 20
	OpenAIMaxInputs     = 16
	OpenAIMaxInputBytes = 16 << 20
	DashScopeMaxInputs  = 3
	DashScopeMaxBytes   = 10 << 20
	UpstreamErrorChars  = 400
	MediaDirName        = "media"
)

type Connection struct {
	Protocol string `json:"protocol,omitempty"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
}

type GenerateRequest struct {
	Workdir      string     `json:"workdir"`
	Connection   Connection `json:"connection"`
	Prompt       string     `json:"prompt"`
	Size         string     `json:"size,omitempty"`
	Background   string     `json:"background,omitempty"`
	OutputFormat string     `json:"outputFormat,omitempty"`
}

type EditRequest struct {
	Workdir       string     `json:"workdir"`
	SourceWorkdir string     `json:"sourceWorkdir,omitempty"`
	Connection    Connection `json:"connection"`
	Prompt        string     `json:"prompt"`
	ImagePaths    []string   `json:"imagePaths"`
	MaskPath      string     `json:"maskPath,omitempty"`
	Size          string     `json:"size,omitempty"`
	Background    string     `json:"background,omitempty"`
	OutputFormat  string     `json:"outputFormat,omitempty"`
}

type AssetResult struct {
	Path         string `json:"path"`
	AbsolutePath string `json:"absolutePath"`
	SHA256       string `json:"sha256"`
	MIME         string `json:"mimeType"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	Bytes        int    `json:"bytes"`
}

type ImageClient struct {
	Timeout             time.Duration
	EndpointDialContext func(ctx context.Context, network, addr string) (net.Conn, error)
	PublicResolver      security.IPResolver
	PublicDialer        *net.Dialer
}

type ImageError struct {
	Dispatched bool
	Message    string
}

func (e *ImageError) Error() string {
	return e.Message
}

func (c *ImageClient) Generate(ctx context.Context, req GenerateRequest) (AssetResult, error) {
	conn, endpointURL, err := validateConnection(req.Connection)
	if err != nil {
		return AssetResult{}, &ImageError{Dispatched: false, Message: err.Error() + ". Nothing was billed."}
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return AssetResult{}, &ImageError{Dispatched: false, Message: "image generation requires a non-empty prompt. Nothing was billed."}
	}
	if err := validateProtocolOptions(conn.Protocol, req.Background, req.OutputFormat, false); err != nil {
		return AssetResult{}, &ImageError{Dispatched: false, Message: err.Error() + ". Nothing was billed."}
	}

	var apiPath string
	var payload []byte
	switch conn.Protocol {
	case ProtocolOpenAIImages:
		apiPath = OpenAIGenerationsPath
		body := map[string]any{
			"model":  conn.Model,
			"prompt": prompt,
			"n":      1,
		}
		if req.Size != "" {
			body["size"] = req.Size
		}
		if req.Background != "" {
			body["background"] = req.Background
		}
		if req.OutputFormat != "" {
			body["output_format"] = req.OutputFormat
		}
		payload, err = json.Marshal(body)
	case ProtocolDashScope:
		apiPath = DashScopePath
		payload, err = buildDashScopePayload(conn.Model, prompt, nil, req.Size)
	default:
		return AssetResult{}, &ImageError{Dispatched: false, Message: fmt.Sprintf("unsupported image protocol %q. Nothing was billed.", conn.Protocol)}
	}
	if err != nil {
		return AssetResult{}, &ImageError{Dispatched: false, Message: fmt.Sprintf("marshal request: %v. Nothing was billed.", err)}
	}

	return c.dispatchAndPublish(ctx, req.Workdir, conn, endpointURL, apiPath, payload)
}

func (c *ImageClient) Edit(ctx context.Context, req EditRequest) (AssetResult, error) {
	conn, endpointURL, err := validateConnection(req.Connection)
	if err != nil {
		return AssetResult{}, &ImageError{Dispatched: false, Message: err.Error() + ". Nothing was billed."}
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return AssetResult{}, &ImageError{Dispatched: false, Message: "image edit requires a non-empty prompt. Nothing was billed."}
	}
	if err := validateProtocolOptions(conn.Protocol, req.Background, req.OutputFormat, strings.TrimSpace(req.MaskPath) != ""); err != nil {
		return AssetResult{}, &ImageError{Dispatched: false, Message: err.Error() + ". Nothing was billed."}
	}

	maxInputs := OpenAIMaxInputs
	maxInputBytes := int64(OpenAIMaxInputBytes)
	if conn.Protocol == ProtocolDashScope {
		maxInputs = DashScopeMaxInputs
		maxInputBytes = DashScopeMaxBytes
	}
	if len(req.ImagePaths) == 0 || len(req.ImagePaths) > maxInputs {
		return AssetResult{}, &ImageError{
			Dispatched: false,
			Message:    fmt.Sprintf("image edit requires 1 to %d input images for %s. Nothing was billed.", maxInputs, conn.Protocol),
		}
	}

	roots := []security.PathRoot{{Dir: req.Workdir}}
	if strings.TrimSpace(req.SourceWorkdir) != "" && req.SourceWorkdir != req.Workdir {
		roots = append(roots, security.PathRoot{Dir: req.SourceWorkdir})
	}
	var totalBytes int64
	dataURLs := make([]string, 0, len(req.ImagePaths))
	var firstW, firstH int
	for idx, p := range req.ImagePaths {
		_, raw, readErr := security.ReadAllowedFileBounded(p, req.Workdir, roots, false, maxInputBytes)
		if readErr != nil {
			return AssetResult{}, &ImageError{Dispatched: false, Message: fmt.Sprintf("read input image: %v. Nothing was billed.", readErr)}
		}
		totalBytes += int64(len(raw))
		if totalBytes > MaxEditTotalBytes {
			return AssetResult{}, &ImageError{Dispatched: false, Message: "total edit input image bytes exceed 64 MiB limit. Nothing was billed."}
		}
		decoded, decErr := imaging.InspectAndDecodeBounded(raw, true)
		if decErr != nil {
			return AssetResult{}, &ImageError{Dispatched: false, Message: fmt.Sprintf("invalid input image: %v. Nothing was billed.", decErr)}
		}
		if idx == 0 {
			firstW, firstH = decoded.Width, decoded.Height
		}
		dataURLs = append(dataURLs, fmt.Sprintf("data:%s;base64,%s", decoded.MIME, base64.StdEncoding.EncodeToString(raw)))
	}

	var maskDataURL string
	if strings.TrimSpace(req.MaskPath) != "" {
		_, rawMask, readErr := security.ReadAllowedFileBounded(req.MaskPath, req.Workdir, roots, false, maxInputBytes)
		if readErr != nil {
			return AssetResult{}, &ImageError{Dispatched: false, Message: fmt.Sprintf("read mask image: %v. Nothing was billed.", readErr)}
		}
		totalBytes += int64(len(rawMask))
		if totalBytes > MaxEditTotalBytes {
			return AssetResult{}, &ImageError{Dispatched: false, Message: "total edit input bytes exceed 64 MiB limit. Nothing was billed."}
		}
		decodedMask, decErr := imaging.InspectAndDecodeBounded(rawMask, false)
		if decErr != nil || decodedMask.MIME != imaging.MimePNG {
			return AssetResult{}, &ImageError{Dispatched: false, Message: "edit mask must be a valid PNG image. Nothing was billed."}
		}
		if decodedMask.Width != firstW || decodedMask.Height != firstH {
			return AssetResult{}, &ImageError{Dispatched: false, Message: fmt.Sprintf("edit mask dimensions %dx%d must match first input image %dx%d. Nothing was billed.", decodedMask.Width, decodedMask.Height, firstW, firstH)}
		}
		maskDataURL = fmt.Sprintf("data:%s;base64,%s", decodedMask.MIME, base64.StdEncoding.EncodeToString(rawMask))
	}

	var apiPath string
	var payload []byte
	switch conn.Protocol {
	case ProtocolOpenAIImages:
		apiPath = OpenAIEditsPath
		images := make([]map[string]string, 0, len(dataURLs))
		for _, du := range dataURLs {
			images = append(images, map[string]string{"image_url": du})
		}
		body := map[string]any{
			"model":  conn.Model,
			"prompt": prompt,
			"images": images,
			"n":      1,
		}
		if maskDataURL != "" {
			body["mask"] = map[string]string{"image_url": maskDataURL}
		}
		if req.Size != "" {
			body["size"] = req.Size
		}
		if req.Background != "" {
			body["background"] = req.Background
		}
		if req.OutputFormat != "" {
			body["output_format"] = req.OutputFormat
		}
		payload, err = json.Marshal(body)
	case ProtocolDashScope:
		apiPath = DashScopePath
		payload, err = buildDashScopePayload(conn.Model, prompt, dataURLs, req.Size)
	default:
		return AssetResult{}, &ImageError{Dispatched: false, Message: fmt.Sprintf("unsupported image protocol %q. Nothing was billed.", conn.Protocol)}
	}
	if err != nil {
		return AssetResult{}, &ImageError{Dispatched: false, Message: fmt.Sprintf("marshal edit request: %v. Nothing was billed.", err)}
	}

	return c.dispatchAndPublish(ctx, req.Workdir, conn, endpointURL, apiPath, payload)
}

func (c *ImageClient) dispatchAndPublish(
	ctx context.Context,
	workdir string,
	conn Connection,
	endpointURL *url.URL,
	apiPath string,
	payload []byte,
) (AssetResult, error) {
	if strings.TrimSpace(workdir) == "" {
		return AssetResult{}, &ImageError{Dispatched: false, Message: "workdir is required. Nothing was billed."}
	}
	if err := ctx.Err(); err != nil {
		return AssetResult{}, &ImageError{Dispatched: false, Message: "image request cancelled before dispatch. Nothing was billed."}
	}
	targetURL := conn.BaseURL + apiPath
	status, respBytes, err := c.doSingleRequest(ctx, http.MethodPost, targetURL, map[string]string{
		"Authorization": "Bearer " + conn.APIKey,
		"Content-Type":  "application/json",
	}, payload, MaxResponseBytes, false)
	if err != nil {
		return AssetResult{}, &ImageError{
			Dispatched: true,
			Message:    RedactCredential(fmt.Sprintf("image request transport failed (%s). Request was sent and may have been billed; do not retry automatically.", sanitizeTransportError(err)), conn.APIKey),
		}
	}
	if status < 200 || status >= 300 {
		detail := describeUpstreamBody(respBytes, conn.APIKey)
		return AssetResult{}, &ImageError{
			Dispatched: true,
			Message:    RedactCredential(fmt.Sprintf("image request rejected with HTTP %d%s. Request was sent and may have been billed; do not retry automatically without changing the request or checking settings.", status, detail), conn.APIKey),
		}
	}

	var imageBytes []byte
	var returnedURL string
	switch conn.Protocol {
	case ProtocolOpenAIImages:
		b64, u, parseErr := parseOpenAIResponse(respBytes, conn.APIKey)
		if parseErr != nil {
			return AssetResult{}, &ImageError{
				Dispatched: true,
				Message:    RedactCredential(parseErr.Error()+". Request was sent and may have been billed; do not retry automatically.", conn.APIKey),
			}
		}
		if b64 != "" {
			decoded, decErr := decodeBase64Image(b64)
			if decErr != nil {
				return AssetResult{}, &ImageError{Dispatched: true, Message: RedactCredential(decErr.Error()+". Request was sent and may have been billed; do not retry automatically.", conn.APIKey)}
			}
			imageBytes = decoded
		} else {
			returnedURL = u
		}
	case ProtocolDashScope:
		u, parseErr := parseDashScopeResponse(respBytes, conn.APIKey)
		if parseErr != nil {
			return AssetResult{}, &ImageError{
				Dispatched: true,
				Message:    RedactCredential(parseErr.Error()+". Request was sent and may have been billed; do not retry automatically.", conn.APIKey),
			}
		}
		returnedURL = u
	}

	if len(imageBytes) == 0 {
		if returnedURL == "" {
			return AssetResult{}, &ImageError{Dispatched: true, Message: "image response carried no image payload. Request was sent and may have been billed; do not retry automatically."}
		}
		parsedResultURL, parseErr := validateReturnedImageURL(returnedURL)
		if parseErr != nil {
			return AssetResult{}, &ImageError{Dispatched: true, Message: RedactCredential(fmt.Sprintf("refusing returned image URL (%s). Request was sent and may have been billed; do not retry automatically.", parseErr.Error()), conn.APIKey)}
		}
		publicOnly := !strings.EqualFold(parsedResultURL.Host, endpointURL.Host)
		dlStatus, dlBytes, dlErr := c.doSingleRequest(ctx, http.MethodGet, parsedResultURL.String(), nil, nil, imaging.MaxImageBytes, publicOnly)
		if dlErr != nil {
			return AssetResult{}, &ImageError{
				Dispatched: true,
				Message:    RedactCredential(fmt.Sprintf("failed to download generated image (%s). Request was sent and may have been billed; do not retry automatically.", sanitizeTransportError(dlErr)), conn.APIKey),
			}
		}
		if dlStatus < 200 || dlStatus >= 300 {
			return AssetResult{}, &ImageError{
				Dispatched: true,
				Message:    fmt.Sprintf("generated image download failed with HTTP %d. Request was sent and may have been billed; do not retry automatically.", dlStatus),
			}
		}
		imageBytes = dlBytes
	}

	if err := ctx.Err(); err != nil {
		return AssetResult{}, &ImageError{
			Dispatched: true,
			Message:    "image request was cancelled before asset publication. Request was sent and may have been billed; do not retry automatically.",
		}
	}
	asset, pubErr := WriteGeneratedImageAssetContext(ctx, workdir, imageBytes)
	if pubErr != nil {
		return AssetResult{}, &ImageError{
			Dispatched: true,
			Message:    RedactCredential(fmt.Sprintf("failed to import generated image (%s). Request was sent and may have been billed; do not retry automatically.", pubErr.Error()), conn.APIKey),
		}
	}
	return asset, nil
}

func (c *ImageClient) doSingleRequest(
	ctx context.Context,
	method string,
	targetURL string,
	headers map[string]string,
	body []byte,
	maxBytes int64,
	publicDestinationOnly bool,
) (int, []byte, error) {
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = DefaultImageTimeout
	}
	var dialFn func(ctx context.Context, network, addr string) (net.Conn, error)
	if publicDestinationOnly {
		dialer := c.PublicDialer
		if dialer == nil {
			dialer = &net.Dialer{Timeout: timeout}
		}
		dialFn = security.NewPublicDialContext(c.PublicResolver, dialer)
	} else if c.EndpointDialContext != nil {
		dialFn = c.EndpointDialContext
	} else {
		dialFn = (&net.Dialer{Timeout: timeout}).DialContext
	}

	transport := &http.Transport{
		DialContext:         dialFn,
		TLSHandshakeTimeout: timeout,
		ForceAttemptHTTP2:   true,
	}
	defer transport.CloseIdleConnections()

	httpClient := &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("redirects are disabled for image MCP requests")
		},
	}

	var bodyReader io.Reader
	if len(body) > 0 {
		bodyReader = bytes.NewReader(body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, targetURL, bodyReader)
	if err != nil {
		return 0, nil, err
	}
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}

	resp, err := httpClient.Do(httpReq)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	respBytes, readErr := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if readErr != nil {
		return resp.StatusCode, nil, readErr
	}
	if int64(len(respBytes)) > maxBytes {
		return resp.StatusCode, nil, fmt.Errorf("response exceeded maximum allowed %d bytes", maxBytes)
	}
	return resp.StatusCode, respBytes, nil
}

func validateConnection(conn Connection) (Connection, *url.URL, error) {
	protocol := strings.TrimSpace(conn.Protocol)
	if protocol == "" {
		protocol = ProtocolOpenAIImages
	}
	if protocol != ProtocolOpenAIImages && protocol != ProtocolDashScope {
		return Connection{}, nil, fmt.Errorf("unsupported image protocol %q", protocol)
	}
	normalizedURL, err := security.ValidateImageEndpointURL(conn.BaseURL)
	if err != nil {
		return Connection{}, nil, err
	}
	parsed, err := url.Parse(normalizedURL)
	if err != nil {
		return Connection{}, nil, err
	}
	apiKey := strings.TrimSpace(conn.APIKey)
	if apiKey == "" {
		return Connection{}, nil, errors.New("image connection API key is required")
	}
	model := strings.TrimSpace(conn.Model)
	if model == "" {
		return Connection{}, nil, errors.New("image model is required (no product default)")
	}
	return Connection{
		Protocol: protocol,
		BaseURL:  normalizedURL,
		APIKey:   apiKey,
		Model:    model,
	}, parsed, nil
}

func validateProtocolOptions(protocol, background, outputFormat string, hasMask bool) error {
	bg := strings.ToLower(strings.TrimSpace(background))
	of := strings.ToLower(strings.TrimSpace(outputFormat))
	if bg == "transparent" && of == "jpeg" {
		return errors.New("transparent background is incompatible with jpeg output_format")
	}
	if protocol == ProtocolDashScope {
		if hasMask {
			return errors.New("dashscope protocol does not support edit masks")
		}
		if bg != "" && bg != "auto" {
			return errors.New("dashscope protocol does not support custom background options")
		}
		if of != "" && of != "png" {
			return errors.New("dashscope protocol only supports png output_format")
		}
	}
	return nil
}

func buildDashScopePayload(model, prompt string, imageDataURLs []string, size string) ([]byte, error) {
	content := make([]map[string]string, 0, len(imageDataURLs)+1)
	for _, du := range imageDataURLs {
		content = append(content, map[string]string{"image": du})
	}
	content = append(content, map[string]string{"text": prompt})
	params := map[string]any{
		"n":             1,
		"prompt_extend": false,
		"watermark":     false,
	}
	if trimmed := strings.TrimSpace(size); trimmed != "" {
		params["size"] = strings.ReplaceAll(strings.ToLower(trimmed), "x", "*")
	}
	body := map[string]any{
		"model": model,
		"input": map[string]any{
			"messages": []map[string]any{
				{
					"role":    "user",
					"content": content,
				},
			},
		},
		"parameters": params,
	}
	return json.Marshal(body)
}

func parseOpenAIResponse(raw []byte, apiKey string) (b64 string, imgURL string, err error) {
	var parsed struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
			URL     string `json:"url"`
		} `json:"data"`
	}
	if jsonErr := json.Unmarshal(raw, &parsed); jsonErr != nil {
		return "", "", errors.New("image generation failed: the response was not valid JSON")
	}
	if len(parsed.Data) == 0 {
		return "", "", fmt.Errorf("image generation failed: the response carried no image%s", describeUpstreamBody(raw, apiKey))
	}
	return parsed.Data[0].B64JSON, strings.TrimSpace(parsed.Data[0].URL), nil
}

func parseDashScopeResponse(raw []byte, apiKey string) (string, error) {
	var parsed struct {
		Output struct {
			Choices []struct {
				Message struct {
					Content []struct {
						Image string `json:"image"`
					} `json:"content"`
				} `json:"message"`
			} `json:"choices"`
		} `json:"output"`
	}
	if jsonErr := json.Unmarshal(raw, &parsed); jsonErr != nil {
		return "", errors.New("image generation failed: the response was not valid JSON")
	}
	for _, ch := range parsed.Output.Choices {
		for _, item := range ch.Message.Content {
			if strings.TrimSpace(item.Image) != "" {
				return strings.TrimSpace(item.Image), nil
			}
		}
	}
	return "", fmt.Errorf("image generation failed: the response carried no image%s", describeUpstreamBody(raw, apiKey))
}

func decodeBase64Image(b64 string) ([]byte, error) {
	maxEncoded := ((imaging.MaxImageBytes + 2) / 3) * 4
	if len(b64) > maxEncoded {
		return nil, errors.New("image generation failed: base64 image exceeds the byte limit")
	}
	decoded, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || base64.StdEncoding.EncodeToString(decoded) != b64 {
		return nil, errors.New("image generation failed: the image is not canonical base64")
	}
	if len(decoded) == 0 {
		return nil, errors.New("image generation failed: the returned image was empty")
	}
	if len(decoded) > imaging.MaxImageBytes {
		return nil, fmt.Errorf("image generation failed: the image exceeds %d bytes", imaging.MaxImageBytes)
	}
	return decoded, nil
}

var embeddedURLPattern = regexp.MustCompile(`(?i)https?://[^\s"<>]+`)

func sanitizeTransportError(err error) string {
	if err == nil {
		return ""
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) && urlErr.Err != nil {
		return stripURLQueryStrings(urlErr.Err.Error())
	}
	return stripURLQueryStrings(err.Error())
}

func stripURLQueryStrings(msg string) string {
	return embeddedURLPattern.ReplaceAllStringFunc(msg, func(match string) string {
		trimmed := match
		for {
			next := strings.TrimRight(trimmed, ",.;:'")
			if strings.HasSuffix(next, ")") && strings.Count(next, ")") > strings.Count(next, "(") {
				next = next[:len(next)-1]
			}
			if next == trimmed {
				break
			}
			trimmed = next
		}
		suffix := match[len(trimmed):]
		parsed, err := url.Parse(trimmed)
		if err != nil {
			return "[redacted-url]" + suffix
		}
		parsed.User = nil
		parsed.RawQuery = ""
		parsed.Fragment = ""
		return parsed.String() + suffix
	})
}

func validateReturnedImageURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, errors.New("returned image URL is malformed")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("unsupported returned URL scheme")
	}
	if parsed.Host == "" {
		return nil, errors.New("returned image URL has no host")
	}
	if parsed.User != nil {
		return nil, errors.New("returned image URL contains embedded credentials")
	}
	return parsed, nil
}

func describeUpstreamBody(raw []byte, apiKey string) string {
	limit := UpstreamErrorChars * 4
	snippet := raw
	if len(snippet) > limit {
		snippet = snippet[:limit]
	}
	msg := strings.TrimSpace(string(snippet))
	var parsed struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if json.Unmarshal(snippet, &parsed) == nil {
		if parsed.Error != nil && strings.TrimSpace(parsed.Error.Message) != "" {
			msg = strings.TrimSpace(parsed.Error.Message)
		} else if strings.TrimSpace(parsed.Message) != "" {
			if strings.TrimSpace(parsed.Code) != "" {
				msg = strings.TrimSpace(parsed.Code) + ": " + strings.TrimSpace(parsed.Message)
			} else {
				msg = strings.TrimSpace(parsed.Message)
			}
		}
	}
	if msg == "" {
		return ""
	}
	redacted := RedactCredential(stripURLQueryStrings(msg), apiKey)
	if len(redacted) > UpstreamErrorChars {
		redacted = redacted[:UpstreamErrorChars]
	}
	return ": " + redacted
}

func WriteGeneratedImageAsset(workdir string, data []byte) (AssetResult, error) {
	return WriteGeneratedImageAssetContext(context.Background(), workdir, data)
}

func WriteGeneratedImageAssetContext(ctx context.Context, workdir string, data []byte) (AssetResult, error) {
	if err := ctx.Err(); err != nil {
		return AssetResult{}, err
	}
	if len(data) == 0 || len(data) > imaging.MaxImageBytes {
		return AssetResult{}, errors.New("image exceeds allowed byte range")
	}
	frozen := append([]byte(nil), data...)
	decoded, err := imaging.InspectAndDecodeBounded(frozen, false)
	if err != nil {
		return AssetResult{}, fmt.Errorf("design intake rejected image: %w", err)
	}
	ext, ok := imaging.ExtensionForStaticMIME(decoded.MIME)
	if !ok {
		return AssetResult{}, errors.New("returned bytes are not PNG, JPEG, or GIF")
	}

	sum := sha256.Sum256(frozen)
	digest := hex.EncodeToString(sum[:])
	fileName := digest + "." + ext
	relPath := MediaDirName + "/" + fileName

	absRoot, err := filepath.Abs(workdir)
	if err != nil {
		return AssetResult{}, err
	}
	if err := os.MkdirAll(absRoot, 0o755); err != nil {
		return AssetResult{}, err
	}
	workRoot, err := os.OpenRoot(absRoot)
	if err != nil {
		return AssetResult{}, err
	}
	defer workRoot.Close()
	resolvedRoot, evalErr := filepath.EvalSymlinks(absRoot)
	if evalErr != nil {
		resolvedRoot = absRoot
	}

	if err := workRoot.Mkdir(MediaDirName, 0o755); err != nil && !os.IsExist(err) {
		return AssetResult{}, err
	}
	parentInfo, err := workRoot.Lstat(MediaDirName)
	if err != nil {
		return AssetResult{}, err
	}
	if parentInfo.Mode()&os.ModeSymlink != 0 || !parentInfo.IsDir() {
		return AssetResult{}, errors.New("media directory must be a real workspace directory")
	}
	mediaRoot, err := workRoot.OpenRoot(MediaDirName)
	if err != nil {
		return AssetResult{}, errors.New("media directory must be a real workspace directory")
	}
	defer mediaRoot.Close()

	if err := ctx.Err(); err != nil {
		return AssetResult{}, err
	}
	matched, err := matchesExistingAssetInRoot(mediaRoot, fileName, frozen)
	if err != nil {
		return AssetResult{}, err
	}
	if !matched {
		if err := publishAssetAtomicallyInRoot(ctx, mediaRoot, fileName, frozen); err != nil {
			return AssetResult{}, err
		}
	}

	return AssetResult{
		Path:         relPath,
		AbsolutePath: filepath.Join(resolvedRoot, MediaDirName, fileName),
		SHA256:       digest,
		MIME:         decoded.MIME,
		Width:        decoded.Width,
		Height:       decoded.Height,
		Bytes:        len(frozen),
	}, nil
}

func matchesExistingAssetInRoot(mediaRoot *os.Root, fileName string, expected []byte) (bool, error) {
	info, err := mediaRoot.Lstat(fileName)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return false, errors.New("refusing to write over a non-regular file")
	}
	f, err := mediaRoot.Open(fileName)
	if err != nil {
		return false, errors.New("refusing to overwrite an unrelated file at the content-addressed path")
	}
	defer f.Close()
	existing, err := io.ReadAll(io.LimitReader(f, int64(len(expected))+1))
	if err != nil || !bytes.Equal(existing, expected) {
		return false, errors.New("refusing to overwrite an unrelated file at the content-addressed path")
	}
	return true, nil
}

func publishAssetAtomicallyInRoot(ctx context.Context, mediaRoot *os.Root, fileName string, data []byte) error {
	var nonce [8]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return err
	}
	tmpName := fmt.Sprintf("%s.%s.tmp", fileName, hex.EncodeToString(nonce[:]))
	f, err := mediaRoot.OpenFile(tmpName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer func() {
		_ = mediaRoot.Remove(tmpName)
	}()
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := mediaRoot.Link(tmpName, fileName); err != nil {
		if os.IsExist(err) {
			matched, matchErr := matchesExistingAssetInRoot(mediaRoot, fileName, data)
			if matchErr != nil {
				return matchErr
			}
			if matched {
				return nil
			}
		}
		return err
	}
	return nil
}
