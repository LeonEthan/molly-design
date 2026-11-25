package main

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

type dataRoot struct {
	path string
	info os.FileInfo
}

func bindDataRoot(path string) (*dataRoot, error) {
	if path == "" {
		return nil, nil
	}
	if !filepath.IsAbs(path) {
		return nil, errors.New("allowedDataRoot must be absolute")
	}
	path = filepath.Clean(path)
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() {
		return nil, errors.New("invalid allowedDataRoot directory")
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return nil, err
	}
	current, err := os.Stat(path)
	if err != nil || !os.SameFile(info, current) {
		return nil, errors.New("allowedDataRoot changed")
	}
	marker, err := os.Lstat(filepath.Join(path, ".molly-mygo-experimental"))
	if err != nil || !marker.Mode().IsRegular() {
		return nil, errors.New("invalid allowedDataRoot marker")
	}
	return &dataRoot{path, current}, nil
}

func (r *dataRoot) authorize(path string) (string, error) {
	if r == nil {
		return path, nil
	}
	requested, err := os.Stat(path)
	if err != nil || !os.SameFile(requested, r.info) {
		return "", errors.New("unauthorized data root")
	}
	current, err := os.Lstat(r.path)
	if err != nil || !current.IsDir() || !os.SameFile(current, r.info) {
		return "", errors.New("bound data root changed")
	}
	return r.path, nil
}

func (r *dataRoot) databasePath(path string) (string, error) {
	dir := filepath.Dir(path)
	if !filepath.IsAbs(path) || filepath.Base(path) != "preferences.sqlite" || filepath.Base(dir) != "memory" {
		return "", errors.New("unauthorized memory database path")
	}
	root, err := r.authorize(filepath.Dir(dir))
	if err != nil {
		return "", err
	}
	dir = filepath.Join(root, "memory")
	info, err := os.Lstat(dir)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	if err == nil && !info.IsDir() {
		return "", errors.New("invalid memory directory")
	}
	db := filepath.Join(dir, "preferences.sqlite")
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		file := db + suffix
		info, err := os.Lstat(file)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if !info.Mode().IsRegular() {
			return "", errors.New("invalid memory database file")
		}
		count, err := fileLinkCount(file, info)
		if err != nil {
			return "", err
		}
		if count != 1 {
			return "", errors.New("invalid memory database link count")
		}
	}
	return db, nil
}

func readHandshake(input io.Reader) (string, *dataRoot, io.Reader, error) {
	invalid := errors.New("invalid stdin handshake")
	if input == nil {
		return "", nil, nil, invalid
	}
	reader := bufio.NewReaderSize(input, 64<<10)
	type frame struct {
		AuthToken       string `json:"authToken"`
		AllowedDataRoot string `json:"allowedDataRoot"`
	}
	received := make(chan frame, 1)
	go func() {
		var f frame
		line, err := reader.ReadSlice('\n')
		if err != nil || json.Unmarshal(line, &f) != nil {
			f = frame{}
		}
		received <- f
	}()
	select {
	case f := <-received:
		if len(f.AuthToken) != 64 {
			return "", nil, nil, invalid
		}
		if _, err := hex.DecodeString(f.AuthToken); err != nil {
			return "", nil, nil, invalid
		}
		root, err := bindDataRoot(f.AllowedDataRoot)
		if err != nil {
			return "", nil, nil, errors.New("invalid stdin handshake data root")
		}
		return f.AuthToken, root, reader, nil
	case <-time.After(5 * time.Second):
		return "", nil, nil, errors.New("stdin handshake timeout")
	}
}
