package translation

import (
	"fmt"
	"testing"
)

var text = "Hello, World!"

func TestGoogleTrans(t *testing.T) {

	for i := 0; i < 10; i++ {
		result, _ := GoogleTrans(text)
		fmt.Println(result)
	}
}

func TestBingTrans(t *testing.T) {
	for i := 0; i < 10; i++ {
		result := BingTrans(text)
		fmt.Println(result)
	}
}

func TestAliTrans(t *testing.T) {
	for i := 0; i < 10; i++ {
		result, _ := AliTrans(text)
		fmt.Println(result)
	}
}
