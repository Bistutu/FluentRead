package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/sashabaranov/go-openai"

	"FluentRead/misc/log"
	"FluentRead/models/constant"
	"FluentRead/repo/db"
)

const count = 15

func main() {
	ctx := context.Background()
	client := openai.NewClient(os.Getenv("OPENAI_API_KEY"))
	tokenCount := 0

	trans, err := db.ListNotTranslated(ctx)
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

	// 构建请求
	builder := strings.Builder{}
	q := newQueue(openai.GPT3Dot5Turbo1106, 1)
	q.systemRole = openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleSystem,
		Content: strings.Replace(constant.SystemRoleMsg, "{{site}}", pageInfo.Link, -1),
	}

	for i := 0; i < transSize; i += count {

		fmt.Printf("\n新的翻译 %d >>>\n", (i/count)+1)
		builder.Reset()

		end := i + count
		if end > transSize {
			end = transSize
		}

		buildCount := 0
		for j := i; j < end; j++ {
			// 句子写入 builder
			replace := strings.Replace(trans[j].Source, "\n", " ", -1)
			builder.WriteString(fmt.Sprintf("%s\n", replace))
			buildCount++
		}

		q.push(openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: builder.String()})
		request := q.build()
		resp, err := client.CreateChatCompletion(ctx, request)
		if err != nil {
			log.Error("LLM.CreateChatCompletion err:", err)
			continue
		}

		// 获取翻译结果
		split := strings.Split(resp.Choices[0].Message.Content, "\n")
		if len(split) != buildCount {
			log.Errorf("翻译结果数量不符，数量 len(split) %d != %d：%s", len(split), buildCount, split)
			continue
		}

		for k, translated := range split {
			trans[i+k].Target = translated
			trans[i+k].Translated = true
		}

		if err = db.BatchUpdateTrans(ctx, trans[i:end]); err != nil {
			log.Error("批量更新数据库失败:", err)
			continue
		}

		q.push(resp.Choices[0].Message)
		tokenCount += resp.Usage.TotalTokens
		fmt.Printf("本次token消耗数：%d, 总消耗数：%d\n%s\n", resp.Usage.TotalTokens, tokenCount, resp.Choices[0].Message.Content)
	}
}
