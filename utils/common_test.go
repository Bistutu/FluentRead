package utils

import (
	"testing"
)

// check是否为英语单词性能测试
func BenchmarkCheck(b *testing.B) {
	msg := "😃check"
	b.Run("spider", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			IsEnglish(msg)
		}
	})
}
