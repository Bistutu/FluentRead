package models

import (
	"gorm.io/gorm"
)

// cache 键的规范：域名:哈希值

// Translation 翻译文本模型
type Translation struct {
	Source     string `json:"source" gorm:"column:source;type:text";`                               // 原文
	Target     string `json:"target" gorm:"column:target;type:text"`                                // 译文
	Hash       string `json:"hash" gorm:"column:hash;type:char(20);unique;"`                        // 哈希值
	Translated bool   `json:"translated" gorm:"column:translated;type:tinyint(1);default:0"`        // 是否已经翻译
	TargetType uint   `json:"target_type" gorm:"column:target_type"`                                // 0 表示未知，1表示中文
	PageId     uint   `json:"page_id" gorm:"column:page_id;type:int;default:0;index;comment:0表示未知"` // 页面 id
	gorm.Model
}

// Page 页面信息
type Page struct {
	Link     string `json:"link" gorm:"column:link;type:varchar(512);unique;"` // 页面链接
	Describe string `json:"describe" gorm:"column:describe;type:varchar(256)"` // 页面描述信息
	gorm.Model
}

// BatchTransToMap 将批量翻译结果转换为 map
func BatchTransToMap(transModels []*Translation) map[string]string {
	rs := make(map[string]string, len(transModels))
	for _, v := range transModels {
		rs[v.Hash] = v.Target
	}
	return rs
}

// PageToMap 将页面数组转换为 map，key：页面链接，value：页面更新时间的哈希值
func PageToMap(pages []*Page) map[string]string {
	rs := make(map[string]string, len(pages))
	for _, v := range pages {
		rs[v.Link] = Signature(v.UpdatedAt.String())
	}
	return rs
}
