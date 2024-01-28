package main

import (
	"github.com/sashabaranov/go-openai"
)

type queue struct {
	request    openai.ChatCompletionRequest
	systemRole openai.ChatCompletionMessage
	assistants []openai.ChatCompletionMessage
	capacity   int
}

func newQueue(model string, capacity int) *queue {
	return &queue{
		request:    openai.ChatCompletionRequest{Model: model},
		assistants: make([]openai.ChatCompletionMessage, 0, capacity),
		capacity:   capacity,
	}
}

func (q *queue) push(assistant openai.ChatCompletionMessage) {
	if len(q.assistants) >= q.capacity {
		// 移除队首元素
		q.assistants = q.assistants[1:]
	}
	q.assistants = append(q.assistants, assistant)
}

func (q *queue) pop() openai.ChatCompletionMessage {
	if len(q.assistants) == 0 {
		return openai.ChatCompletionMessage{}
	}
	assistant := q.assistants[0]
	q.assistants = q.assistants[1:]
	return assistant
}

// 构建上下文对话的请求
func (q *queue) build() openai.ChatCompletionRequest {
	messages := make([]openai.ChatCompletionMessage, 0, q.capacity+1)
	messages = append(messages, q.systemRole)
	for _, v := range q.assistants {
		messages = append(messages, v)
	}
	q.request.Messages = messages
	return q.request
}
