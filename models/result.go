package models

// Result 通用响应结构
type Result struct {
	Code int         `json:"code"`
	Msg  string      `json:"msg"`
	Data interface{} `json:"Data"`
}

func OK(data interface{}) *Result {
	return &Result{
		Code: 0,
		Msg:  "ok",
		Data: data,
	}
}
