package logic

import (
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

var (
	ctx = &gin.Context{}
)

func TestReadByPage(t *testing.T) {
	read, err := PageRead(ctx, "https://www.consul.io/")
	assert.NoError(t, err)
	t.Log(read)

	read, err = PageRead(ctx, "https://music.unmeta.cn/")
	assert.NoError(t, err)
	t.Log(read)
}
