package db

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"

	"FluentRead/models"
)

func TestInsertAndGet(t *testing.T) {
	ctx := context.Background()

	text := "Overview"
	target := "简介"
	signature := "demo_signature"

	model := &models.Translation{
		Model: gorm.Model{
			ID: 0,
		},
		Hash:       signature,
		Source:     text,
		TargetType: 1,
		Target:     target,
	}
	err := InsertTrans(ctx, model)
	assert.NoError(t, err)

	one, err := GetOne(ctx, signature)
	assert.NoError(t, err)
	assert.Equal(t, target, one.Target)
}

func TestListNotTranslated(t *testing.T) {
	list, err := ListNotTranslated(context.Background())
	assert.NoError(t, err)
	t.Log(list)
}
