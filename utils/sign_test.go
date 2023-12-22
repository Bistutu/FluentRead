package utils

import (
	"testing"
)

func TestSign(t *testing.T) {
	signature := Signature("overview")
	t.Log(signature)
}
