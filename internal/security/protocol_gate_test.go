package security

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestProtocolWriteGateBlocksBlindWritesAndAllowsTrustedWorkbench(t *testing.T) {
	cfg := ProtocolWriteGateConfig{
		CapabilityToken: "inst-secret-token-0123456789abcdef",
		AllowedOrigin:   "molly://workbench",
		RequireBaseRev:  true,
	}

	var writes atomic.Int32
	handler := WriteGateMiddleware(cfg, func(w http.ResponseWriter, _ *http.Request, _ []byte) {
		writes.Add(1)
		w.WriteHeader(http.StatusOK)
	})

	negativeCases := []struct {
		name        string
		method      string
		origin      string
		secFetch    string
		contentType string
		token       string
		body        string
		wantStatus  int
	}{
		{
			name:        "untrusted page no-cors text/plain blind write",
			method:      http.MethodPost,
			origin:      "https://untrusted.example.com",
			secFetch:    "cross-site",
			contentType: "text/plain",
			token:       "",
			body:        `{"baseRevisionId":"rev-1"}`,
			wantStatus:  http.StatusForbidden,
		},
		{
			name:        "trusted origin but wrong content-type form-urlencoded",
			method:      http.MethodPost,
			origin:      "molly://workbench",
			secFetch:    "same-origin",
			contentType: "application/x-www-form-urlencoded",
			token:       cfg.CapabilityToken,
			body:        `{"baseRevisionId":"rev-1"}`,
			wantStatus:  http.StatusUnsupportedMediaType,
		},
		{
			name:        "trusted caller missing capability token",
			method:      http.MethodPost,
			origin:      "molly://workbench",
			secFetch:    "same-origin",
			contentType: "application/json",
			token:       "",
			body:        `{"baseRevisionId":"rev-1"}`,
			wantStatus:  http.StatusForbidden,
		},
		{
			name:        "trusted caller wrong origin",
			method:      http.MethodPost,
			origin:      "https://evil.example.com",
			secFetch:    "cross-site",
			contentType: "application/json",
			token:       cfg.CapabilityToken,
			body:        `{"baseRevisionId":"rev-1"}`,
			wantStatus:  http.StatusForbidden,
		},
		{
			name:        "trusted caller empty baseRevisionId",
			method:      http.MethodPost,
			origin:      "molly://workbench",
			secFetch:    "same-origin",
			contentType: "application/json",
			token:       cfg.CapabilityToken,
			body:        `{"baseRevisionId":"   "}`,
			wantStatus:  http.StatusConflict,
		},
	}

	for _, tc := range negativeCases {
		req := httptest.NewRequest(tc.method, "http://molly.local/api/design/save", bytes.NewBufferString(tc.body))
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		if tc.secFetch != "" {
			req.Header.Set("Sec-Fetch-Site", tc.secFetch)
		}
		if tc.contentType != "" {
			req.Header.Set("Content-Type", tc.contentType)
		}
		if tc.token != "" {
			req.Header.Set(CapabilityTokenHeader, tc.token)
		}
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != tc.wantStatus {
			t.Errorf("%s: status = %d, want %d", tc.name, rec.Code, tc.wantStatus)
		}
	}
	if writes.Load() != 0 {
		t.Fatalf("expected 0 writes on negative cases, got %d", writes.Load())
	}

	okReq := httptest.NewRequest(http.MethodPost, "http://molly.local/api/design/save", bytes.NewBufferString(`{"baseRevisionId":"rev-42","doc":{}}`))
	okReq.Header.Set("Origin", "molly://workbench")
	okReq.Header.Set("Sec-Fetch-Site", "same-origin")
	okReq.Header.Set("Content-Type", "application/json; charset=utf-8")
	okReq.Header.Set(CapabilityTokenHeader, cfg.CapabilityToken)
	okRec := httptest.NewRecorder()
	handler.ServeHTTP(okRec, okReq)
	if okRec.Code != http.StatusOK || writes.Load() != 1 {
		t.Fatalf("trusted write failed: status=%d writes=%d", okRec.Code, writes.Load())
	}
}

func TestValidateTopLevelNavigationLock(t *testing.T) {
	allowed := "molly://workbench"
	if err := ValidateTopLevelNavigation("molly://workbench/session/123?tab=canvas", allowed); err != nil {
		t.Fatalf("expected trusted workbench navigation to pass, got %v", err)
	}
	for _, blocked := range []string{
		"https://evil.example.com/phish",
		"http://127.0.0.1:8080/",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"data:text/html,<h1>x</h1>",
		"molly://untrusted/page",
	} {
		if err := ValidateTopLevelNavigation(blocked, allowed); err == nil {
			t.Errorf("expected top-level navigation to %q to be blocked", blocked)
		}
	}
}
