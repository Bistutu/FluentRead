package cache

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSet(t *testing.T) {
	ctx := context.Background()

	msg := []string{"test1", "value1"}
	err := SetKey(ctx, msg[0], msg[1])
	assert.NoError(t, err)

	rs, err := GetKey(ctx, msg[0])
	assert.NoError(t, err)
	assert.Equal(t, msg[1], rs)
}

func TestDuplicate(t *testing.T) {
	ctx := context.Background()

	msg := []string{"test1", "value1"}
	rdb.Del(ctx, msg[0])
	fmt.Println(rdb.SetNX(ctx, msg[0], msg[1], 0).Result())
	fmt.Println(rdb.SetNX(ctx, msg[0], msg[1], 0).Result())
}
