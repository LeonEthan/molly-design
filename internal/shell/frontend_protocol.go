package shell

import (
	"bytes"
	"io/fs"
	"strings"
)

type rendererFiles struct {
	fs.FS
	platform string
}
type rendererIndex struct {
	*bytes.Reader
	info fs.FileInfo
}

func (f *rendererIndex) Close() error               { return nil }
func (f *rendererIndex) Stat() (fs.FileInfo, error) { return f.info, nil }

type rendererIndexInfo struct {
	fs.FileInfo
	size int64
}

func (f rendererIndexInfo) Size() int64 { return f.size }

func (f rendererFiles) Open(name string) (fs.File, error) {
	if f.platform != "windows" || name != "index.html" {
		return f.FS.Open(name)
	}
	data, err := fs.ReadFile(f.FS, name)
	if err != nil {
		return nil, err
	}
	info, err := fs.Stat(f.FS, name)
	if err != nil {
		return nil, err
	}
	html := strings.ReplaceAll(string(data), " molly-resource: ", " "+protocolOrigin(f.platform, "molly-resource", "file")+" ")
	return &rendererIndex{bytes.NewReader([]byte(html)), rendererIndexInfo{info, int64(len(html))}}, nil
}
