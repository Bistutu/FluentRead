package utils

import (
	"crypto/sha1"
	"encoding/hex"
)

// Signature 返回 1/2 的 SHA-1 散列值
func Signature(text string) string {
	if text == "" {
		return ""
	}

	hasher := sha1.New()
	// 将输入文本转换为字节序列，并写入散列器。返回值：写入的字节数、错误
	_, _ = hasher.Write([]byte(text))

	// 计算散列值，得到字节序列。
	hashedBytes := hasher.Sum(nil)
	// 将字节序列转换为十六进制编码的字符串
	hashedString := hex.EncodeToString(hashedBytes)

	return hashedString[20:]
}
