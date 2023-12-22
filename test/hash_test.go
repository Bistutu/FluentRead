package main

import (
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"fmt"
	"testing"
)

func TestHashText(t *testing.T) {
	data := []byte("some data to hash")
	fmt.Printf("%x\n", md5.Sum(data))
	fmt.Printf("%x\n", sha1.Sum(data))
	fmt.Printf("%x\n", sha256.Sum256(data))
	fmt.Printf("%x\n", sha512.Sum512(data))
}

func TestBatchParse(t *testing.T) {
	data := []byte("Get OrbStack")
	sum := sha1.Sum(data)
	fmt.Printf("%x\n", sum[10:])
}

func TestLength(t *testing.T) {
	data := []byte("some data to hash")

	// 只取一半

	sum := md5.Sum(data)
	fmt.Printf("%x\n", sum[8:])

	sh1 := sha1.Sum(data)
	fmt.Printf("%x\n", sh1[10:])
}

func TestSize(t *testing.T) {
	// 10 字节，重复100次，0.98KB
	fmt.Printf("%.2f KB\n", 10.0*100/1024)
	// 8 字节，重复100次，0.78KB
	fmt.Printf("%.2f KB\n", 8.0*100/1024)
}

func BenchmarkHash(b *testing.B) {
	b.Run("md5", func(b *testing.B) {
		data := []byte("some data to hash")
		for i := 0; i < b.N; i++ {
			_ = md5.Sum(data)
		}
	})
	b.Run("sha1", func(b *testing.B) {
		data := []byte("some data to hash")
		for i := 0; i < b.N; i++ {
			_ = sha1.Sum(data)
		}
	})
	b.Run("sha256", func(b *testing.B) {
		data := []byte("some data to hash")
		for i := 0; i < b.N; i++ {
			_ = sha256.Sum256(data)
		}
	})
	b.Run("sha512", func(b *testing.B) {
		data := []byte("some data to hash")
		for i := 0; i < b.N; i++ {
			_ = sha512.Sum512(data)
		}
	})
}

func BenchmarkConcat(b *testing.B) {
	b.Run("sha256", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = sha256.Sum256([]byte("some data to hash"))
		}
	})
	b.Run("sha256", func(b *testing.B) {
		for i := 0; i < b.N; i++ {
			_ = sha256.Sum256([]byte("some data to hash" + "test"))
		}
	})

}
