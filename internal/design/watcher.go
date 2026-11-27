package design

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type WatchEvent struct {
	Directory string
	Paths     []string
}

type Watcher struct {
	fw        *fsnotify.Watcher
	directory string
	debounce  time.Duration
	events    chan WatchEvent
	done      chan struct{}
	closeOnce sync.Once
}

func NewWatcher(ctx context.Context, directory string, debounce time.Duration) (*Watcher, error) {
	if debounce <= 0 {
		debounce = 50 * time.Millisecond
	}
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := fw.Add(directory); err != nil {
		_ = fw.Close()
		return nil, err
	}
	w := &Watcher{
		fw:        fw,
		directory: directory,
		debounce:  debounce,
		events:    make(chan WatchEvent, 16),
		done:      make(chan struct{}),
	}
	go w.loop(ctx)
	return w, nil
}

func (w *Watcher) Events() <-chan WatchEvent {
	return w.events
}

func (w *Watcher) Close() error {
	var err error
	w.closeOnce.Do(func() {
		err = w.fw.Close()
		<-w.done
	})
	return err
}

func (w *Watcher) loop(ctx context.Context) {
	defer close(w.done)
	defer close(w.events)

	pending := make(map[string]struct{})
	var timer *time.Timer
	var timerCh <-chan time.Time

	flush := func() {
		if len(pending) == 0 {
			return
		}
		paths := make([]string, 0, len(pending))
		for p := range pending {
			paths = append(paths, p)
			delete(pending, p)
		}
		select {
		case w.events <- WatchEvent{Directory: w.directory, Paths: paths}:
		default:
		}
	}

	stopTimer := func() {
		if timer != nil {
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer = nil
			timerCh = nil
		}
	}

	defer stopTimer()

	for {
		select {
		case <-ctx.Done():
			_ = w.fw.Close()
			return
		case ev, ok := <-w.fw.Events:
			if !ok {
				return
			}
			if shouldIgnoreWatchPath(ev.Name) {
				continue
			}
			pending[ev.Name] = struct{}{}
			if timer == nil {
				timer = time.NewTimer(w.debounce)
				timerCh = timer.C
			} else {
				stopTimer()
				timer = time.NewTimer(w.debounce)
				timerCh = timer.C
			}
		case _, ok := <-w.fw.Errors:
			if !ok {
				return
			}
		case <-timerCh:
			timer = nil
			timerCh = nil
			flush()
		}
	}
}

func shouldIgnoreWatchPath(path string) bool {
	base := filepath.Base(path)
	if base == LockFilename {
		return true
	}
	if strings.HasPrefix(base, ".") && (strings.HasSuffix(base, ".tmp") || strings.HasSuffix(base, ".stale")) {
		return true
	}
	return false
}
