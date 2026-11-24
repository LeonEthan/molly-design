package mcp

import (
	"net/url"
	"regexp"
	"strings"
)

const redactedToken = "[redacted]"

var (
	authHeaderPattern = regexp.MustCompile(`(?i)\b(bearer|basic)\s+[^\s"',;]+`)
	skKeyPattern      = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{8,}\b`)
)

func RedactCredential(text string, apiKey string) string {
	out := text
	key := strings.TrimSpace(apiKey)
	if key != "" {
		out = strings.ReplaceAll(out, key, redactedToken)
		if escaped := url.QueryEscape(key); escaped != key {
			out = strings.ReplaceAll(out, escaped, redactedToken)
		}
		if pathEscaped := url.PathEscape(key); pathEscaped != key {
			out = strings.ReplaceAll(out, pathEscaped, redactedToken)
		}
	}
	out = authHeaderPattern.ReplaceAllString(out, "$1 "+redactedToken)
	out = skKeyPattern.ReplaceAllString(out, redactedToken)
	return out
}
