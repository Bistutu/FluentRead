package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	baidu "github.com/anhao/go-ernie"

	"FluentRead/misc/log"
	"FluentRead/models/constant"
	"FluentRead/repo/db"
)

func main() {

	ctx := context.Background()
	count := 10
	tokenCount := 0

	//trans, err := db.ListNotTranslated(ctx)
	trans, err := db.ListTrans(ctx)
	if err != nil {
		log.Error("获取未翻译列表失败:", err)
		return
	}
	transSize := len(trans)

	// 获取页面信息
	pageInfo, err := db.GetPageById(ctx, trans[0].PageId)
	if err != nil {
		log.Error("获取页面信息失败:", err)
		return
	}

	// 提示语
	systemMsg := strings.Replace(constant.CommonMsg, "{{site}}", pageInfo.Link, -1)
	builder := strings.Builder{}

	// 准备模型
	client := baidu.NewDefaultClient(os.Getenv("BAIDU_KEY"), os.Getenv("BAIDU_SECRET"))

	for i := 0; i < transSize; i += count {
		if i != 1000 {
			continue
		}

		fmt.Printf("\n新的翻译 %d >>>\n", (i/count)+1)
		builder.Reset()

		end := i + count
		if end > transSize {
			end = transSize
		}

		buildCount := 0
		for j := i; j < end; j++ {
			replace := strings.Replace(trans[j].Source, "\n", " ", -1)
			builder.WriteString(fmt.Sprintf("%s\n", replace))
			buildCount++
		}

		// 发起请求
		resp, err := client.CreateErnieBotChatCompletion(ctx, baidu.ErnieBotRequest{
			Messages: []baidu.ChatCompletionMessage{
				{
					Role:    baidu.MessageRoleUser,
					Content: systemMsg + builder.String(),
				},
			},
		})
		if err != nil {
			log.Error("获取翻译失败:", err)
			continue
		}
		tokenCount += resp.Usage.TotalTokens
		fmt.Printf("本次token消耗数：%d, 总消耗数：%d\n%s\n", resp.Usage.TotalTokens, tokenCount, resp.Result)
	}
}
