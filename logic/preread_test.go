package logic

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPreRead(t *testing.T) {
	ctx := context.Background()
	preRead, err := PreRead(ctx)
	assert.NoError(t, err)
	t.Log(preRead)
}
