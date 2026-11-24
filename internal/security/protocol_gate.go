package security

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
)

const (
	CapabilityTokenHeader   = "X-Molly-Capability-Token"
	MaxWriteBodyBytes       = 4 << 20
	MaxDesignWriteBodyBytes = 64 << 20
)

type ProtocolWriteGateConfig struct {
	CapabilityToken               string
	AllowedOrigin                 string
	AllowOpaqueCustomSchemeOrigin bool
	RequireBaseRev                bool
	MaxBodyBytes                  int64
}

type ProtocolWriteGateError struct {
	Status int
	Code   string
	Reason string
}

func (e *ProtocolWriteGateError) Error() string {
	return e.Code + ": " + e.Reason
}

func ValidateProtocolWriteRequest(r *http.Request, cfg ProtocolWriteGateConfig) ([]byte, error) {
	if r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodPatch {
		return nil, &ProtocolWriteGateError{Status: http.StatusMethodNotAllowed, Code: "method_not_allowed", Reason: "write endpoint requires POST/PUT/PATCH"}
	}
	if strings.TrimSpace(cfg.CapabilityToken) == "" {
		return nil, &ProtocolWriteGateError{Status: http.StatusForbidden, Code: "missing_gate_token", Reason: "server capability token not configured"}
	}
	token := r.Header.Get(CapabilityTokenHeader)
	if len(token) != len(cfg.CapabilityToken) || subtle.ConstantTimeCompare([]byte(token), []byte(cfg.CapabilityToken)) != 1 {
		return nil, &ProtocolWriteGateError{Status: http.StatusForbidden, Code: "invalid_capability_token", Reason: "missing or invalid capability token"}
	}

	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		return nil, &ProtocolWriteGateError{Status: http.StatusUnsupportedMediaType, Code: "invalid_content_type", Reason: "write endpoint requires Content-Type: application/json"}
	}

	if cfg.AllowedOrigin != "" {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		opaqueAllowed := cfg.AllowOpaqueCustomSchemeOrigin && (origin == "" || strings.EqualFold(origin, "null"))
		if !opaqueAllowed && (origin == "" || !strings.EqualFold(origin, cfg.AllowedOrigin)) {
			return nil, &ProtocolWriteGateError{Status: http.StatusForbidden, Code: "invalid_origin", Reason: "request origin is not the trusted workbench"}
		}
		if opaqueAllowed {
			referer := strings.TrimSpace(r.Header.Get("Referer"))
			if referer != "" && !strings.HasPrefix(strings.ToLower(referer), strings.ToLower(cfg.AllowedOrigin)+"/") && !strings.EqualFold(referer, cfg.AllowedOrigin) {
				return nil, &ProtocolWriteGateError{Status: http.StatusForbidden, Code: "invalid_referer", Reason: "request referer does not match trusted surface origin"}
			}
		}
	}
	secFetchSite := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")))
	if secFetchSite != "" && secFetchSite != "same-origin" && secFetchSite != "none" {
		return nil, &ProtocolWriteGateError{Status: http.StatusForbidden, Code: "cross_site_blocked", Reason: "cross-site write request refused"}
	}

	maxBody := cfg.MaxBodyBytes
	if maxBody <= 0 {
		maxBody = MaxWriteBodyBytes
	}
	if r.ContentLength > maxBody {
		return nil, &ProtocolWriteGateError{Status: http.StatusRequestEntityTooLarge, Code: "body_too_large", Reason: "write payload exceeds maximum size"}
	}
	body, readErr := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if readErr != nil {
		return nil, &ProtocolWriteGateError{Status: http.StatusBadRequest, Code: "read_failed", Reason: readErr.Error()}
	}
	if int64(len(body)) > maxBody {
		return nil, &ProtocolWriteGateError{Status: http.StatusRequestEntityTooLarge, Code: "body_too_large", Reason: "write payload exceeds maximum size"}
	}

	var envelope struct {
		BaseRevisionID string `json:"baseRevisionId"`
	}
	if jsonErr := json.Unmarshal(body, &envelope); jsonErr != nil {
		return nil, &ProtocolWriteGateError{Status: http.StatusBadRequest, Code: "invalid_json", Reason: "write payload must be valid JSON"}
	}
	if cfg.RequireBaseRev && strings.TrimSpace(envelope.BaseRevisionID) == "" {
		return nil, &ProtocolWriteGateError{Status: http.StatusConflict, Code: "missing_base_revision", Reason: "baseRevisionId is required for CAS writes"}
	}
	return body, nil
}

func WriteGateMiddleware(cfg ProtocolWriteGateConfig, next func(w http.ResponseWriter, r *http.Request, body []byte)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := ValidateProtocolWriteRequest(r, cfg)
		if err != nil {
			var gateErr *ProtocolWriteGateError
			status := http.StatusForbidden
			code := "forbidden"
			if errors.As(err, &gateErr) {
				status = gateErr.Status
				code = gateErr.Code
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error": code,
			})
			return
		}
		next(w, r, body)
	})
}

func ValidateTopLevelNavigation(targetURL string, allowedOrigin string) error {
	target, err := url.Parse(strings.TrimSpace(targetURL))
	if err != nil || target.Scheme == "" || target.Host == "" {
		return &ProtocolWriteGateError{Status: http.StatusForbidden, Code: "invalid_navigation_target", Reason: "navigation target must be a valid origin URL"}
	}
	allowed, err := url.Parse(strings.TrimSpace(allowedOrigin))
	if err != nil || allowed.Scheme == "" || allowed.Host == "" {
		return &ProtocolWriteGateError{Status: http.StatusForbidden, Code: "invalid_allowed_origin", Reason: "allowed origin is not configured"}
	}
	if !strings.EqualFold(target.Scheme, allowed.Scheme) || !strings.EqualFold(target.Host, allowed.Host) {
		return &ProtocolWriteGateError{Status: http.StatusForbidden, Code: "navigation_origin_locked", Reason: "top-level navigation outside trusted workbench origin is blocked"}
	}
	return nil
}
