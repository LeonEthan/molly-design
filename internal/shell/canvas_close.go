package shell

import (
	"context"
	"errors"
	"maps"
	"sync"

	"github.com/egoist/mygo"
)

type quitPhase uint8

const (
	quitIdle quitPhase = iota
	quitConfirming
	quitApproved
)

type canvasExit struct {
	closingArtwork map[string]bool
	mu             sync.Mutex
	phase          quitPhase
	token          string
	closing        map[*mygo.Window]string
	approved       map[*mygo.Window]bool
}

func (c *mygoDesignController) targets(id, host string, win *mygo.Window) []*mygoCanvasInstance {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []*mygoCanvasInstance
	for _, i := range c.instances {
		if (id == "" || id == i.artworkID) && (host == "" || host == i.hostID) && (win == nil || win == i.win) {
			out = append(out, i)
		}
	}
	return out
}

func (c *mygoDesignController) confirmCanvasClose(i *mygoCanvasInstance, owner string) (bool, bool) {
	return confirmClose(c.gate, i, owner, func() (int, error) {
		result, err := mygo.Dialog.Message(mygo.MessageOptions{Parent: i.win, Title: "Unsaved drawing", Message: "The drawing could not be confirmed saved.", Buttons: []string{"Keep Editing", "Retry Save", "Discard"}, DestructiveButtons: []int{2}})
		return result.Button, err
	})
}

type closingCanvas interface {
	CanvasInstance
	EditorState() (*canvasEditorState, error)
}

func confirmClose(g *CanvasAccessGate, i closingCanvas, owner string, choose func() (int, error)) (bool, bool) {
	id := i.ArtworkID()
	p, writable, seq, _ := g.AcquireCloseFreeze(id, owner)
	for {
		err := g.WaitApplied(context.Background(), seq, id)
		if err == nil {
			g.mu.Lock()
			flights := maps.Clone(g.inFlight[id])
			g.mu.Unlock()
			for done := range flights {
				<-done
			}
			st, e := i.EditorState()
			if e == nil && validateCanvasStateCleanForReload(st) == nil {
				return true, false
			}
			if e == nil && st != nil && writable && g.IsWriteAllowed(id, p) {
				if err = i.Flush(p); err == nil {
					st, e = i.EditorState()
					if e == nil && validateCanvasStateCleanForReload(st) == nil {
						return true, false
					}
				}
			}
		}
		button, e := choose()
		if e != nil {
			return false, false
		}
		switch button {
		case 1:
			p, _, seq, _ = g.AcquireCloseFreeze(id, owner)
		case 2:
			return true, true
		default:
			return false, false
		}
	}
}

func (c *mygoDesignController) closeDesign(id, host string, leave bool, afterClose func() error) (bool, error) {
	x := &c.exit
	x.mu.Lock()
	if x.phase != quitIdle || len(x.closing) > 0 || x.closingArtwork[id] {
		x.mu.Unlock()
		return false, nil
	}
	if x.closingArtwork == nil {
		x.closingArtwork = make(map[string]bool)
	}
	x.closingArtwork[id] = true
	x.mu.Unlock()
	defer func() { x.mu.Lock(); delete(x.closingArtwork, id); x.mu.Unlock() }()
	owner := randomHexToken(16)
	defer c.gate.ReleaseCloseFreezeByOwner(owner)
	var retire []*mygoCanvasInstance
	for _, i := range c.targets(id, host, nil) {
		ok, discard := c.confirmCanvasClose(i, owner)
		if !ok {
			return false, nil
		}
		if !leave || discard {
			retire = append(retire, i)
		}
	}
	for _, i := range retire {
		c.designHost.RevokeSurface(i.surface.Host)
		i.win.Destroy()
	}
	if !leave && afterClose != nil {
		return true, afterClose()
	}
	return true, nil
}

func (c *mygoDesignController) guardWindow(win *mygo.Window, workbench bool) {
	x := &c.exit
	win.OnClose(func(e *mygo.CloseEvent) {
		x.mu.Lock()
		defer x.mu.Unlock()
		if x.phase == quitApproved || x.approved[win] {
			return
		}
		e.PreventDefault()
		if x.phase == quitConfirming || x.closing[win] != "" || len(x.closingArtwork) > 0 {
			return
		}
		owner := randomHexToken(16)
		x.closing[win] = owner
		go func() {
			target := win
			if workbench {
				target = nil
			}
			for _, i := range c.targets("", "", target) {
				if ok, _ := c.confirmCanvasClose(i, owner); !ok {
					c.gate.ReleaseCloseFreezeByOwner(owner)
					x.mu.Lock()
					delete(x.closing, win)
					x.mu.Unlock()
					return
				}
			}
			mygo.RunOnMain(func() { x.mu.Lock(); x.approved[win] = true; x.mu.Unlock(); win.Close() })
		}()
	})
	win.OnClosed(func() {
		x.mu.Lock()
		owner := x.closing[win]
		delete(x.closing, win)
		delete(x.approved, win)
		x.mu.Unlock()
		if owner != "" {
			if workbench {
				for _, inst := range c.targets("", "", nil) {
					inst.win.Destroy()
				}
			}
			c.gate.ReleaseCloseFreezeByOwner(owner)
		}
	})
}

func (x *canvasExit) beginQuit(ending bool, prevent func()) string {
	x.mu.Lock()
	defer x.mu.Unlock()
	if ending {
		x.phase = quitApproved
		x.token = ""
		return ""
	}
	if x.phase == quitApproved {
		return ""
	}
	prevent()
	if x.phase != quitIdle || len(x.closing) > 0 || len(x.closingArtwork) > 0 {
		return ""
	}
	x.phase = quitConfirming
	x.token = randomHexToken(16)
	return x.token
}

func (c *mygoDesignController) finishQuit(owner string, confirm func(*mygoCanvasInstance, string) (bool, bool), quit func()) {
	x := &c.exit
	for _, i := range c.targets("", "", nil) {
		if ok, _ := confirm(i, owner); !ok {
			c.gate.ReleaseCloseFreezeByOwner(owner)
			x.mu.Lock()
			if x.phase == quitConfirming && x.token == owner {
				x.phase = quitIdle
				x.token = ""
			}
			x.mu.Unlock()
			return
		}
	}
	mygo.RunOnMain(func() {
		x.mu.Lock()
		approved := x.phase == quitConfirming && x.token == owner
		if approved {
			x.phase = quitApproved
		}
		x.mu.Unlock()
		if approved {
			quit()
		}
	})
}

func (c *mygoDesignController) guardQuit() {
	x := &c.exit
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		if owner := x.beginQuit(e.SessionEnding, e.PreventDefault); owner != "" {
			go c.finishQuit(owner, c.confirmCanvasClose, mygo.App.Quit)
		}
	})
	mygo.App.OnQuitCanceled(func() {
		if owner := x.canceled(); owner != "" {
			c.gate.SetUpdating(false)
			c.gate.ReleaseCloseFreezeByOwner(owner)
		}
	})
}

func (c *mygoDesignController) PrepareUpdateFlush(confirm func(*mygoCanvasInstance, string) (bool, bool)) (func(), error) {
	if confirm == nil {
		confirm = c.confirmCanvasClose
	}
	x := &c.exit
	x.mu.Lock()
	if x.phase != quitIdle || len(x.closing) > 0 || len(x.closingArtwork) > 0 {
		x.mu.Unlock()
		return nil, errors.New("canvas_close_in_progress")
	}
	owner := randomHexToken(16)
	x.phase = quitConfirming
	x.token = owner
	x.mu.Unlock()

	rollback := func() {
		c.gate.SetUpdating(false)
		c.gate.ReleaseCloseFreezeByOwner(owner)
		x.mu.Lock()
		if x.token == owner {
			x.phase = quitIdle
			x.token = ""
		}
		x.mu.Unlock()
	}

	// Defer installation while any Agent turn or design preparation is active
	// (or daemon state is unknown), even when no canvas editor window is open.
	if err := c.gate.AssertIdleForUpdate(); err != nil {
		rollback()
		return nil, err
	}

	// Confirm and flush every open canvas while the gate is still writable and
	// the private CLI/design worker are still running, so Retry Save works and
	// Keep Editing leaves the session intact.
	for _, i := range c.targets("", "", nil) {
		if ok, _ := confirm(i, owner); !ok {
			rollback()
			return nil, errors.New("update_canceled_unsaved_design")
		}
	}

	// Fence new Agent turns/prepares, then confirm no turn started concurrently
	// during the canvas flush before approving update quit.
	c.gate.SetUpdating(true)
	if err := c.gate.AssertIdleForUpdate(); err != nil {
		rollback()
		return nil, err
	}

	x.mu.Lock()
	approved := x.phase == quitConfirming && x.token == owner
	if approved {
		x.phase = quitApproved
	}
	x.mu.Unlock()
	if !approved {
		rollback()
		return nil, errors.New("canvas_close_in_progress")
	}
	return rollback, nil
}

func (x *canvasExit) canceled() string {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.phase != quitApproved {
		return ""
	}
	x.phase = quitIdle
	owner := x.token
	x.token = ""
	return owner
}
