package shell

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"sync"
	"time"
)

func controlIdleTimeout(path string, body []byte) time.Duration {
	var message struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(body, &message)
	if path == "/project-control" {
		switch message.Type {
		case "local-project/list-files", "local-project/list-skills", "local-project/list-global-skills", "worktree/list-files", "local-project/sync-history", "local-project/import-history", "local-project/resolve-history-conflict":
			return 120 * time.Second
		default:
			return 20 * time.Second
		}
	}
	switch message.Type {
	case "machine/acp-capabilities-refresh":
		return 1_610_000 * time.Millisecond
	case "machine/acp-authenticate", "machine/acp-binary-install":
		return 300 * time.Second
	case "session/file-send-local":
		return 120 * time.Second
	default:
		return 10 * time.Second
	}
}

type activityDeadlineConn struct {
	net.Conn
	mu   sync.Mutex
	idle time.Duration
	now  func() time.Time
}

func (c *activityDeadlineConn) renew() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.Conn.SetDeadline(c.now().Add(c.idle))
}

func (c *activityDeadlineConn) Read(b []byte) (int, error) {
	n, err := c.Conn.Read(b)
	if n > 0 {
		if deadlineErr := c.renew(); err == nil {
			err = deadlineErr
		}
	}
	return n, err
}

func (c *activityDeadlineConn) Write(b []byte) (int, error) {
	n, err := c.Conn.Write(b)
	if n > 0 {
		if deadlineErr := c.renew(); err == nil {
			err = deadlineErr
		}
	}
	return n, err
}

func (b *MollyBridge) idleIPCClient(endpoint string, idle time.Duration) *http.Client {
	return &http.Client{Transport: &http.Transport{DisableKeepAlives: true, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		ctx, cancel := context.WithTimeout(ctx, idle)
		defer cancel()
		conn, err := b.dialLocal(ctx, endpoint)
		if err != nil {
			return nil, err
		}
		c := &activityDeadlineConn{Conn: conn, idle: idle, now: time.Now}
		if err := c.renew(); err != nil {
			conn.Close()
			return nil, err
		}
		return c, nil
	}}}
}
