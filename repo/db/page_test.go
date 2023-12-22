package db

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"FluentRead/models"
)

func TestInsertPage(t *testing.T) {
	ctx := context.Background()
	pageId, err := InsertPage(ctx, &models.Page{Link: "www.baidu.com"})
	assert.NoError(t, err)
	t.Log(pageId)
}
