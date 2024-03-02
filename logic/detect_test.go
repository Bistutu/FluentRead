package logic

import (
	"fmt"
	"testing"
)

func BenchmarkDetect(b *testing.B) {
	for i := 0; i < b.N; i++ {
		DetectLanguage("text=正文")
	}
}

func TestDetectLanguage(t *testing.T) {
	fmt.Println(DetectLanguage("哈哈哈"))
}
