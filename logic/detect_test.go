package logic

import "testing"

func BenchmarkDetect(b *testing.B) {
	for i := 0; i < b.N; i++ {
		DetectLanguage("text=正文")
	}
}
