package db

import (
	"context"

	"gorm.io/gorm/clause"

	"FluentRead/models"
)

/*插入/更新*/

// InsertTrans 插入一条翻译记录，冲突时不更新任何字段
func InsertTrans(ctx context.Context, model *models.Translation) (err error) {
	// 跳过一些不需要翻译的短语
	//if utils.IsContain(model.Source, []string{"153 results", "T", "ThinkStu"}) {
	//	return nil
	//}
	return db.Clauses(clause.OnConflict{
		UpdateAll: false,
	}).Create(model).Error
}

// UpdateTrans 更新一条记录
func UpdateTrans(ctx context.Context, model *models.Translation) error {
	return db.Updates(model).Error
}

// BatchUpdateTrans 批量更新记录
func BatchUpdateTrans(ctx context.Context, models []*models.Translation) error {
	// 启动事务
	tx := db.WithContext(ctx).Begin()
	if tx.Error != nil {
		return tx.Error
	}
	// 遍历更新
	for _, model := range models {
		if err := tx.Updates(model).Error; err != nil {
			tx.Rollback() // 如果有错误发生，回滚事务
			return err
		}
	}
	return tx.Commit().Error // 提交事务
}

// BatchInsert 批量插入记录，发生冲突时只更新 updated_at 字段
func BatchInsert(ctx context.Context, models []*models.Translation) error {
	// 发生冲突时，只更新 updated_at 字段
	return db.Clauses(clause.OnConflict{
		DoUpdates: clause.AssignmentColumns([]string{"updated_at"}),
		UpdateAll: false,
	}).CreateInBatches(models, 100).Error
}

/*查询*/

// GetOne 获取一条记录
func GetOne(ctx context.Context, hashCode string) (model *models.Translation, err error) {
	err = db.Where("hash = ?", hashCode).First(&model).Error
	if err != nil {
		return nil, err
	}
	return model, nil
}

// BatchGet 批量获取记录
func BatchGet(ctx context.Context, hashCodes []string) (models []*models.Translation, err error) {
	err = db.Where("hash in (?)", hashCodes).Find(&models).Error
	if err != nil {
		return nil, err
	}
	return models, nil
}

// ListNotTranslated 获取还未翻译的短语
func ListNotTranslated(ctx context.Context) ([]*models.Translation, error) {
	var models []*models.Translation
	return models, db.Where("translated = ?", 0).Order("id").Find(&models).Error
}

// ListTrans 获取所有短语
func ListTrans(ctx context.Context) ([]*models.Translation, error) {
	var models []*models.Translation
	return models, db.Order("id").Find(&models).Error
}

// RemoveTrans 删除
func RemoveTrans(ctx context.Context, trans *models.Translation) error {
	return db.Delete(trans).Error
}
