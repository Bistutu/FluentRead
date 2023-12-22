package cache

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/go-redis/redis/v8"

	"FluentRead/utils"
)

const (
	dsnFormat = "127.0.0.1:%s"
)

var (
	rdb *redis.Client
	//expiration = 72 * time.Hour // 默认缓存 3 天
	// TODO time.Millisecond
	expiration = time.Millisecond // 默认缓存 3 天
)

func init() {
	rdb = redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf(dsnFormat, utils.GetEnvDefault("REDIS_PORT", "16379")), // redis 服务端地址
		Password: utils.GetEnvDefault("REDIS_PASSWORD_FR", "SzW7fh2Fs5d2ypwT"),       // redis 密码
		DB:       0,
	})
}

func SetKey(ctx context.Context, key string, value string) error {
	return rdb.Set(ctx, key, value, expiration).Err()
}

func SetKeyWithTimeout(ctx context.Context, key string, timeout time.Duration, value string) error {
	// TODO
	timeout = time.Millisecond
	return rdb.Set(ctx, key, value, timeout).Err()
}

// SetKeyNotExpiration 永不过期
func SetKeyNotExpiration(ctx context.Context, key string, value string) error {
	return rdb.Set(ctx, key, value, 0).Err()
}

func GetKey(ctx context.Context, key string) (string, error) {
	val, err := rdb.Get(ctx, key).Result()
	// redis.Nil 不是错误，表示 key 不存在
	if err != redis.Nil && err != nil {
		return "", err
	}

	return val, nil
}

func MGet(ctx context.Context, keys ...string) ([]interface{}, error) {
	if len(keys) == 0 {
		return nil, errors.New("keys is empty")
	}

	return rdb.MGet(ctx, keys...).Result()
}

func MSet(ctx context.Context, kv sync.Map) error {
	pipeline := rdb.Pipeline()
	kv.Range(func(k, v any) bool {
		pipeline.Set(ctx, k.(string), v, expiration)
		return true
	})
	// 不关注单个命令的执行结果，只关注 pipeline 执行的结果
	if _, err := pipeline.Exec(ctx); err != nil {
		return err
	}
	return nil
}
