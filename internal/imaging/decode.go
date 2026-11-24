package imaging

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"

	"golang.org/x/image/webp"
)

const (
	MaxImageBytes   = 16 << 20
	MaxEdge         = 16384
	MaxPixels       = 64_000_000
	MaxLongEdge     = 1280
	ContactCellEdge = 400
	ContactGap      = 8
	JPEGQuality     = 70
)

const (
	MimePNG  = "image/png"
	MimeJPEG = "image/jpeg"
	MimeGIF  = "image/gif"
	MimeWebP = "image/webp"
)

type DecodedImage struct {
	Image  image.Image
	MIME   string
	Width  int
	Height int
	Pages  int
}

func SniffStaticMIME(data []byte) string {
	if len(data) >= 8 &&
		data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4e && data[3] == 0x47 &&
		data[4] == 0x0d && data[5] == 0x0a && data[6] == 0x1a && data[7] == 0x0a {
		return MimePNG
	}
	if len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
		return MimeJPEG
	}
	if len(data) >= 6 &&
		data[0] == 'G' && data[1] == 'I' && data[2] == 'F' && data[3] == '8' &&
		(data[4] == '7' || data[4] == '9') && data[5] == 'a' {
		return MimeGIF
	}
	return ""
}

func SniffViewMIME(data []byte) string {
	if mime := SniffStaticMIME(data); mime != "" {
		return mime
	}
	if len(data) >= 12 &&
		data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F' &&
		data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P' {
		return MimeWebP
	}
	return ""
}

func ExtensionForStaticMIME(mime string) (string, bool) {
	switch mime {
	case MimePNG:
		return "png", true
	case MimeJPEG:
		return "jpg", true
	case MimeGIF:
		return "gif", true
	default:
		return "", false
	}
}

func ReadContainerDimensions(data []byte, mime string) (int, int, bool) {
	if SniffStaticMIME(data) != mime {
		return 0, 0, false
	}
	switch mime {
	case MimePNG:
		if len(data) < 33 {
			return 0, 0, false
		}
		if binary.BigEndian.Uint32(data[8:12]) != 13 ||
			data[12] != 'I' || data[13] != 'H' || data[14] != 'D' || data[15] != 'R' {
			return 0, 0, false
		}
		w := int(binary.BigEndian.Uint32(data[16:20]))
		h := int(binary.BigEndian.Uint32(data[20:24]))
		return w, h, w > 0 && h > 0
	case MimeGIF:
		if len(data) < 13 {
			return 0, 0, false
		}
		w := int(binary.LittleEndian.Uint16(data[6:8]))
		h := int(binary.LittleEndian.Uint16(data[8:10]))
		return w, h, w > 0 && h > 0
	case MimeJPEG:
		offset := 2
		for offset+9 <= len(data) {
			if data[offset] != 0xff {
				return 0, 0, false
			}
			if data[offset+1] == 0xff {
				offset++
				continue
			}
			marker := data[offset+1]
			length := int(binary.BigEndian.Uint16(data[offset+2 : offset+4]))
			if length < 2 || offset+2+length > len(data) {
				return 0, 0, false
			}
			if marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc {
				if offset+9 >= len(data) {
					return 0, 0, false
				}
				components := int(data[offset+9])
				if components < 1 || components > 4 || length != 8+3*components {
					return 0, 0, false
				}
				h := int(binary.BigEndian.Uint16(data[offset+5 : offset+7]))
				w := int(binary.BigEndian.Uint16(data[offset+7 : offset+9]))
				return w, h, w > 0 && h > 0
			}
			offset += 2 + length
		}
		return 0, 0, false
	default:
		return 0, 0, false
	}
}

func InspectAndDecodeBounded(data []byte, allowWebP bool) (DecodedImage, error) {
	if len(data) == 0 || len(data) > MaxImageBytes {
		return DecodedImage{}, fmt.Errorf("image exceeds allowed byte range (1..%d bytes)", MaxImageBytes)
	}
	mime := SniffStaticMIME(data)
	if mime == "" && allowWebP {
		mime = SniffViewMIME(data)
	}
	if mime == "" {
		if allowWebP {
			return DecodedImage{}, errors.New("unsupported or invalid image format (expected PNG, JPEG, GIF, or WebP)")
		}
		return DecodedImage{}, errors.New("unsupported or invalid image format (expected PNG, JPEG, or GIF)")
	}

	var cfg image.Config
	var err error
	reader := bytes.NewReader(data)
	switch mime {
	case MimePNG:
		cfg, err = png.DecodeConfig(reader)
	case MimeJPEG:
		cfg, err = jpeg.DecodeConfig(reader)
	case MimeGIF:
		cfg, err = gif.DecodeConfig(reader)
	case MimeWebP:
		cfg, err = webp.DecodeConfig(reader)
	}
	if err != nil {
		return DecodedImage{}, errors.New("image is invalid, truncated, or exceeds decoding limits")
	}

	width := cfg.Width
	height := cfg.Height
	if mime != MimeWebP {
		cw, ch, ok := ReadContainerDimensions(data, mime)
		if !ok {
			return DecodedImage{}, errors.New("image dimensions are missing or invalid")
		}
		if cw > width {
			width = cw
		}
		if ch > height {
			height = ch
		}
	}

	pages := 1
	if mime == MimeGIF {
		frameCount, maxW, maxH, scanErr := scanGIFBounds(data)
		if scanErr != nil {
			return DecodedImage{}, errors.New("image is invalid, truncated, or exceeds decoding limits")
		}
		if maxW > width {
			width = maxW
		}
		if maxH > height {
			height = maxH
		}
		pages = frameCount
	}

	if err := validateDimensions(width, height, pages); err != nil {
		return DecodedImage{}, err
	}

	reader.Reset(data)
	var img image.Image
	switch mime {
	case MimePNG:
		img, err = png.Decode(reader)
	case MimeJPEG:
		img, err = jpeg.Decode(reader)
	case MimeGIF:
		var decoded *gif.GIF
		decoded, err = gif.DecodeAll(reader)
		if err == nil {
			if len(decoded.Image) == 0 {
				return DecodedImage{}, errors.New("image is invalid, truncated, or exceeds decoding limits")
			}
			if len(decoded.Image) > pages {
				pages = len(decoded.Image)
			}
			if dimErr := validateDimensions(width, height, pages); dimErr != nil {
				return DecodedImage{}, dimErr
			}
			canvas := image.NewRGBA(image.Rect(0, 0, width, height))
			first := decoded.Image[0]
			draw.Draw(canvas, first.Bounds(), first, first.Bounds().Min, draw.Src)
			img = canvas
		}
	case MimeWebP:
		img, err = webp.Decode(reader)
	}
	if err != nil || img == nil {
		return DecodedImage{}, errors.New("image is invalid, truncated, or exceeds decoding limits")
	}

	return DecodedImage{
		Image:  img,
		MIME:   mime,
		Width:  width,
		Height: height,
		Pages:  pages,
	}, nil
}

func validateDimensions(width, height, pages int) error {
	if width < 1 || height < 1 || pages < 1 {
		return errors.New("image dimensions are missing or invalid")
	}
	if width > MaxEdge || height > MaxEdge {
		return errors.New("image dimensions exceed the import limits (16384 per edge, 64 million pixels across frames)")
	}
	total := int64(width) * int64(height) * int64(pages)
	if total <= 0 || total > MaxPixels {
		return errors.New("image dimensions exceed the import limits (16384 per edge, 64 million pixels across frames)")
	}
	return nil
}

func scanGIFBounds(data []byte) (frames int, maxW int, maxH int, err error) {
	if len(data) < 13 {
		return 0, 0, 0, errors.New("truncated gif header")
	}
	maxW = int(binary.LittleEndian.Uint16(data[6:8]))
	maxH = int(binary.LittleEndian.Uint16(data[8:10]))
	packed := data[10]
	pos := 13
	if packed&0x80 != 0 {
		gctSize := 3 * (1 << ((packed & 0x07) + 1))
		pos += gctSize
		if pos > len(data) {
			return 0, 0, 0, errors.New("truncated gif global color table")
		}
	}
	for pos < len(data) {
		switch data[pos] {
		case 0x3b:
			if frames == 0 {
				return 0, 0, 0, errors.New("gif contains no frames")
			}
			return frames, maxW, maxH, nil
		case 0x21:
			if pos+2 > len(data) {
				return 0, 0, 0, errors.New("truncated gif extension")
			}
			pos += 2
			next, skipErr := skipGIFSubBlocks(data, pos)
			if skipErr != nil {
				return 0, 0, 0, skipErr
			}
			pos = next
		case 0x2c:
			if pos+10 > len(data) {
				return 0, 0, 0, errors.New("truncated gif frame descriptor")
			}
			left := int(binary.LittleEndian.Uint16(data[pos+1 : pos+3]))
			top := int(binary.LittleEndian.Uint16(data[pos+3 : pos+5]))
			fw := int(binary.LittleEndian.Uint16(data[pos+5 : pos+7]))
			fh := int(binary.LittleEndian.Uint16(data[pos+7 : pos+9]))
			if left+fw > maxW {
				maxW = left + fw
			}
			if top+fh > maxH {
				maxH = top + fh
			}
			lctPacked := data[pos+9]
			pos += 10
			if lctPacked&0x80 != 0 {
				lctSize := 3 * (1 << ((lctPacked & 0x07) + 1))
				pos += lctSize
				if pos > len(data) {
					return 0, 0, 0, errors.New("truncated gif local color table")
				}
			}
			if pos >= len(data) {
				return 0, 0, 0, errors.New("truncated gif lzw minimum code size")
			}
			pos++
			next, skipErr := skipGIFSubBlocks(data, pos)
			if skipErr != nil {
				return 0, 0, 0, skipErr
			}
			pos = next
			frames++
			if int64(maxW)*int64(maxH)*int64(frames) > MaxPixels {
				return frames, maxW, maxH, nil
			}
		default:
			return 0, 0, 0, errors.New("unexpected gif block marker")
		}
	}
	if frames == 0 {
		return 0, 0, 0, errors.New("gif missing terminator")
	}
	return frames, maxW, maxH, nil
}

func skipGIFSubBlocks(data []byte, pos int) (int, error) {
	for {
		if pos >= len(data) {
			return 0, errors.New("truncated gif sub-block")
		}
		blockLen := int(data[pos])
		pos++
		if blockLen == 0 {
			return pos, nil
		}
		pos += blockLen
		if pos > len(data) {
			return 0, errors.New("truncated gif sub-block payload")
		}
	}
}
