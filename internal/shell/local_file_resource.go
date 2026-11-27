package shell

import (
	"bytes"
	"container/list"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"github.com/egoist/mygo"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unicode/utf8"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"
)

const LocalTextEditBytes = 512 * 1024
const LocalTextPageBytes = 64 * 1024

type LocalFileResourceStore struct {
	owner        *mygo.Page
	requireOwner bool
	platform     string
	closed       bool
	mu           sync.Mutex
	currentGen   uint64
	items        map[string]*localResource
	order        list.List
	limit        int
}
type localResource struct {
	root              *os.Root
	name, token, mime string
	version           os.FileInfo
	text, revoked     bool
	readers           map[*os.File]bool
	position          *list.Element
}

func NewLocalFileResourceStore() *LocalFileResourceStore {
	return &LocalFileResourceStore{platform: runtime.GOOS, items: make(map[string]*localResource), limit: 256}
}

func (s *LocalFileResourceStore) CurrentGen() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.currentGen
}

func (s *LocalFileResourceStore) AdvanceGen() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.items {
		s.revoke(r)
	}
	s.currentGen++
	return s.currentGen
}

func (s *LocalFileResourceStore) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	s.currentGen++
	for _, r := range s.items {
		s.revoke(r)
	}
}
func (s *LocalFileResourceStore) RevokeAll() { s.AdvanceGen() }
func (s *LocalFileResourceStore) revoke(r *localResource) {
	r.revoked = true
	r.root.Close()
	for f := range r.readers {
		f.Close()
	}
	s.order.Remove(r.position)
	delete(s.items, r.token)
}

func sameLocalVersion(a, b os.FileInfo) bool {
	return b != nil && os.SameFile(a, b) && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}

func openLocalResource(root *os.Root, name string) (*os.File, os.FileInfo, error) {
	if root == nil || !filepath.IsLocal(name) || filepath.Clean(name) != name {
		return nil, nil, os.ErrInvalid
	}
	components := strings.Split(name, string(filepath.Separator))
	var parent *os.Root
	defer func() {
		if parent != nil {
			parent.Close()
		}
	}()
	for _, component := range components[:len(components)-1] {
		expected, err := root.Lstat(component)
		if err != nil {
			return nil, nil, err
		}
		if !expected.IsDir() {
			return nil, nil, os.ErrInvalid
		}
		next, err := root.OpenRoot(component)
		if err != nil {
			return nil, nil, err
		}
		actual, err := next.Stat(".")
		if err != nil || !os.SameFile(expected, actual) {
			next.Close()
			return nil, nil, os.ErrInvalid
		}
		if parent != nil {
			parent.Close()
		}
		parent = next
		root = next
	}
	name = components[len(components)-1]
	i, e := root.Lstat(name)
	if e != nil {
		return nil, nil, e
	}
	if !i.Mode().IsRegular() {
		return nil, nil, os.ErrInvalid
	}
	flags := os.O_RDONLY
	if runtime.GOOS != "windows" {
		flags |= syscall.O_NONBLOCK
	}
	f, e := root.OpenFile(name, flags, 0)
	if e != nil {
		return nil, nil, e
	}
	j, e := f.Stat()
	if e != nil || !sameLocalVersion(i, j) {
		f.Close()
		return nil, nil, os.ErrInvalid
	}
	return f, j, nil
}

var localImageTypes = map[string]string{".png": "image/png", ".apng": "image/apng", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".jfif": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon", ".cur": "image/x-icon", ".avif": "image/avif"}

func previewAVIFDimensions(data []byte) (int, int) {
	var width, height int
	var avif bool
	var walk func([]byte, int)
	walk = func(b []byte, depth int) {
		for len(b) >= 8 {
			size := uint64(binary.BigEndian.Uint32(b))
			header := 8
			if size == 1 {
				if len(b) < 16 {
					return
				}
				size = binary.BigEndian.Uint64(b[8:])
				header = 16
			} else if size == 0 {
				size = uint64(len(b))
			}
			if size < uint64(header) || size > uint64(len(b)) {
				return
			}
			kind := string(b[4:8])
			body := b[header:size]
			switch {
			case depth == 0 && kind == "ftyp":
				for i := 0; i+4 <= len(body); i += 4 {
					if i != 4 && enumString(string(body[i:i+4]), "avif", "avis", "avio") {
						avif = true
					}
				}
			case depth == 0 && kind == "meta" && len(body) >= 4:
				walk(body[4:], 1)
			case depth == 1 && kind == "iprp":
				walk(body, 2)
			case depth == 2 && kind == "ipco":
				walk(body, 3)
			case depth == 3 && kind == "ispe" && len(body) >= 12:
				w, h := binary.BigEndian.Uint32(body[4:]), binary.BigEndian.Uint32(body[8:])
				if uint64(w)*uint64(h) > uint64(width)*uint64(height) {
					width, height = int(w), int(h)
				}
			}
			b = b[size:]
		}
	}
	walk(data, 0)
	if !avif {
		return 0, 0
	}
	return width, height
}

func previewDimensions(b []byte) (int, int) {
	c, _, e := image.DecodeConfig(bytes.NewReader(b))
	if e == nil {
		return c.Width, c.Height
	}
	if len(b) >= 6 && (binary.LittleEndian.Uint32(b) == 65536 || binary.LittleEndian.Uint32(b) == 131072) {
		n := int(binary.LittleEndian.Uint16(b[4:]))
		if len(b) >= 6+16*n {
			w, h := 0, 0
			for i := range n {
				x, y := int(b[6+16*i]), int(b[7+16*i])
				if x == 0 {
					x = 256
				}
				if y == 0 {
					y = 256
				}
				w = max(w, x)
				h = max(h, y)
			}
			return w, h
		}
	}
	return previewAVIFDimensions(b)
}

func (s *LocalFileResourceStore) Issue(gen uint64, root *os.Root, name, path string, external, resourceOnly bool) (map[string]any, error) {
	f, i, e := openLocalResource(root, name)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b := make([]byte, min(i.Size(), LocalTextEditBytes+1))
	if _, e = f.ReadAt(b, 0); e != nil {
		return nil, e
	}
	j, e := f.Stat()
	if e != nil || !sameLocalVersion(i, j) {
		return nil, errors.New("preview_changed")
	}
	mime := localImageTypes[strings.ToLower(filepath.Ext(path))]
	if mime != "" {
		w, h := previewDimensions(b)
		code, msg := "", ""
		if w <= 0 || h <= 0 {
			code, msg = "decode_error", "Image dimensions could not be read."
		} else if max(w, h) > 32768 || int64(w)*int64(h) > 64<<20 {
			code, msg = "too_large", "Image dimensions exceed the preview memory budget. Open it in a system application."
		}
		if code != "" {
			return map[string]any{"status": "error", "v": 3, "path": path, "code": code, "message": msg}, nil
		}
	}
	sample := b
	if int64(len(b)) < i.Size() {
		for k := max(0, len(b)-3); k < len(b); k++ {
			if !utf8.FullRune(b[k:]) {
				sample = b[:k]
				break
			}
		}
	}
	isText := mime == "" && !bytes.Contains(b[:min(8192, len(b))], []byte{0}) && utf8.Valid(sample)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || gen != s.currentGen {
		return nil, errors.New("preview_revoked")
	}
	if isText && !resourceOnly && i.Size() <= LocalTextEditBytes {
		str := string(b)
		eol := "unknown"
		if strings.Contains(str, "\r\n") {
			eol = "crlf"
			if strings.Contains(strings.ReplaceAll(str, "\r\n", ""), "\n") {
				eol = "mixed"
			}
		} else if strings.Contains(str, "\n") {
			eol = "lf"
		}
		return map[string]any{"status": "ok", "v": 3, "path": path, "external": external, "digest": fmt.Sprintf("sha256:%x", sha256.Sum256(b)), "kind": "text", "sizeBytes": i.Size(), "readonly": true, "content": map[string]any{"encoding": "utf8-plain", "text": str, "rawBytes": len(b)}, "format": map[string]any{"bom": bytes.HasPrefix(b, []byte{0xef, 0xbb, 0xbf}), "eol": eol}}, nil
	}
	if mime == "" {
		mime = "application/octet-stream"
	}
	var r *localResource
	for _, v := range s.items {
		if v.root.Name() == root.Name() && v.name == name && v.mime == mime && sameLocalVersion(i, v.version) {
			r = v
			break
		}
	}
	if r == nil {
		if len(s.items) >= s.limit {
			s.revoke(s.order.Front().Value.(*localResource))
		}
		owned, err := root.OpenRoot(".")
		if err != nil {
			return nil, err
		}
		r = &localResource{root: owned, name: name, version: i, token: randomHex(24), mime: mime, text: isText, readers: map[*os.File]bool{}}
		r.position = s.order.PushBack(r)
		s.items[r.token] = r
	} else {
		s.order.MoveToBack(r.position)
	}
	kind := "binary"
	if isText {
		kind = "text"
	}
	return map[string]any{"status": "resource", "path": path, "external": external, "kind": kind, "sizeBytes": i.Size(), "url": protocolOrigin(s.platform, "molly-resource", "file") + "/" + r.token}, nil
}

var previewRange = regexp.MustCompile("^bytes=([0-9]+)-([0-9]*)$")

func (s *LocalFileResourceStore) ServeHTTP(w http.ResponseWriter, q *http.Request) {
	if q.Method != "GET" && q.Method != "HEAD" {
		w.WriteHeader(405)
		return
	}
	s.mu.Lock()
	origin := protocolOrigin(s.platform, "mygo", "localhost")
	requestOrigin := q.Header.Get("Origin")
	owned := s.owner != nil && mygo.CallerPage(q.Context()) == s.owner
	opaque := owned && s.platform != "windows" && requestOrigin == "null"
	if s.requireOwner && !owned || requestOrigin != "" && requestOrigin != origin && !opaque {
		s.mu.Unlock()
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if opaque {
		origin = "null"
	}
	r := s.items[strings.TrimPrefix(q.URL.Path, "/")]
	target := q.URL.Scheme + "://" + q.URL.Host
	if r == nil || (target != "molly-resource://file" && target != protocolOrigin(s.platform, "molly-resource", "file")) {
		s.mu.Unlock()
		w.WriteHeader(http.StatusNotFound)
		return
	}
	f, i, e := openLocalResource(r.root, r.name)
	if e != nil || !sameLocalVersion(r.version, i) {
		if f != nil {
			f.Close()
		}
		s.mu.Unlock()
		w.WriteHeader(409)
		return
	}
	s.order.MoveToBack(r.position)
	r.readers[f] = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(r.readers, f); f.Close(); s.mu.Unlock() }()
	start, end := int64(0), i.Size()-1
	code := 200
	if ranges := q.Header.Values("Range"); len(ranges) > 0 {
		raw := strings.Join(ranges, ",")
		m := previewRange.FindStringSubmatch(raw)
		if m != nil {
			start, e = strconv.ParseInt(m[1], 10, 64)
			if e == nil && m[2] != "" {
				end, e = strconv.ParseInt(m[2], 10, 64)
			}
		}
		if m == nil || e != nil || start >= i.Size() || end < start {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", i.Size()))
			w.WriteHeader(416)
			return
		}
		end = min(i.Size()-1, end)
		code = 206
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, i.Size()))
	}
	if r.text && (code != 206 || end-start+1 > LocalTextPageBytes+6) {
		w.WriteHeader(416)
		return
	}
	for k, v := range map[string]string{"Content-Type": r.mime, "Content-Length": strconv.FormatInt(end-start+1, 10), "Accept-Ranges": "bytes", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Access-Control-Allow-Origin": origin} {
		w.Header().Set(k, v)
	}
	w.WriteHeader(code)
	if q.Method == "HEAD" {
		return
	}
	buf := make([]byte, LocalTextPageBytes)
	for start <= end {
		chunk := buf[:min(int64(len(buf)), end-start+1)]
		_, e = f.ReadAt(chunk, start)
		s.mu.Lock()
		after, statErr := f.Stat()
		valid := e == nil && statErr == nil && !r.revoked && sameLocalVersion(i, after)
		s.mu.Unlock()
		if !valid || q.Context().Err() != nil {
			panic(http.ErrAbortHandler)
		}
		if _, e = w.Write(chunk); e != nil {
			return
		}
		start += int64(len(chunk))
	}
}
