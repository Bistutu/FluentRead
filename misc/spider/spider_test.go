package spider

import (
	"context"
	"testing"

	"FluentRead/utils"
)

var (
	ctx = context.Background()
)

func TestSnifferSingle(t *testing.T) {
	//snifferSingle(ctx, "https://github.com/")
	//snifferSingle(ctx, "https://www.consul.io/")
	//snifferSingle(ctx, "https://orbstack.dev/")
	//snifferSingle(ctx, "https://orbstack.dev/dashboard")
	//snifferSingle(ctx, "https://orbstack.dev/pricing")
	snifferSingle(ctx, "https://mvnrepository.com/artifact/com.alibaba/fastjson")
	//snifferSingle(ctx, "https://docs.orbstack.dev/legal/terms")
}

// 递归爬取网页及其子页面
func TestSpider(t *testing.T) {
	//sniffer(ctx, "https://github.com/")
	//sniffer(ctx, "https://www.docker.com/")
	//sniffer(ctx, "https://www.docker.com/company/")
	//sniffer(ctx, "https://www.consul.io/")
	//sniffer(ctx, "https://www.coze.com/")
	sniffer(ctx, "https://orbstack.dev/")
}

func TestDiscoverLetter(t *testing.T) {
	t.Log(utils.IsNonChinese("hello"))
	t.Log(utils.IsNonChinese("hello,好"))
	t.Log(utils.IsNonChinese("hello,😄"))
}

func BenchmarkDiscoverLetter(b *testing.B) {
	for i := 0; i < b.N; i++ {
		utils.IsNonChinese("hello")
	}
}
