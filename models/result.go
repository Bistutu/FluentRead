package models

// Result 通用响应结构
type Result struct {
	Code int         `json:"code"`
	Msg  string      `json:"msg"`
	Data interface{} `json:"Data"`
}

func Success(data interface{}) *Result {
	return &Result{
		Code: 0,
		Msg:  "ok",
		Data: data,
	}
}

func Fail(msg string) *Result {
	return &Result{
		Code: -1,
		Msg:  msg,
		Data: nil,
	}
}
