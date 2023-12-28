package main

import (
	"fmt"
	"testing"
	"time"
)

func TestData(t *testing.T) {
	year := 2020
	// 起始日期
	startDate := time.Date(year, time.January, 1, 0, 0, 0, 0, time.UTC)
	// 一直循环直到年份变成xx年
	for date := startDate; date.Year() == year; date = date.AddDate(0, 0, 1) {
		//fmt.Println(date.Format("Jan 02, 2006"))
		fmt.Println(date.Format("2006-01-02"))
	}
}

func TestCount(t *testing.T) {
	for i := 0; i <= 50; i++ {
		// 按照 "Compile Dependencies (i)" 的格式打印每个数字
		//fmt.Println(fmt.Sprintf("Test Dependencies (%d)", i))
		fmt.Println(fmt.Sprintf("测试依赖 Test (%d)", i))
	}
}
