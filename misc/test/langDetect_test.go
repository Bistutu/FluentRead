package main

import (
	"fmt"
	"testing"

	"github.com/Bistutu/whatlanggo"
)

func TestLangdetect(t *testing.T) {
	info := whatlanggo.Detect("中文")
	fmt.Println("Language:", info.Lang.String(), " Script:", whatlanggo.Scripts[info.Script], " Confidence: ", info.Confidence)
}
