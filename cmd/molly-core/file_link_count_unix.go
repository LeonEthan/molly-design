//go:build unix

package main

import (
	"errors"
	"os"
	"syscall"
)

func fileLinkCount(_ string, info os.FileInfo) (uint64, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, errors.New("missing memory database file metadata")
	}
	return uint64(stat.Nlink), nil
}
