package utils

import "testing"

func BenchmarkCheck(b *testing.B) {
	msg := "check"
	b.Run("common", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			IsEnglish(msg)
		}
	})
}
