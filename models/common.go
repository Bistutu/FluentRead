package models

import (
	"container/list"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
)

// Queue 队列
type Queue struct {
	list.List
}

func (q *Queue) Pop() string {
	front := q.List.Front()
	v := front.Value.(string)
	q.Remove(front)
	return v
}

func MapToBytes(m map[string]string) []byte {
	bytes, _ := json.Marshal(m)
	return bytes
}

func MapToString(m map[string]string) string {
	bytes, _ := json.Marshal(m)
	return string(bytes)
}

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
