package models

import (
	"container/list"
	"encoding/json"
)

func MapToString(m map[string]string) string {
	bytes, _ := json.Marshal(m)
	return string(bytes)
}

func StringToMap(s string, m *map[string]string) error {
	return json.Unmarshal([]byte(s), m)
}

// Queue 队列
type Queue struct {
	list.List
}

func (q *Queue) Pop() string {
	front := q.List.Front()
	v := front.Value.(string)
	q.Remove(front)
	return v
}
