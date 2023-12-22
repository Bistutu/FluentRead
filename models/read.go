package models

// ReadRequest 阅读请求
type ReadRequest struct {
	Page       string   `json:"page"`
	TargetType uint     `json:"target_type"`
	HashList   []string `json:"hash_list"`
}

// ReadResponse 阅读响应，hash:target
type ReadResponse struct {
	Data map[string]string `json:"data"`
}
