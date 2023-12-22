package db

import (
	"context"

	"gorm.io/gorm/clause"

	"FluentRead/models"
)

/*插入/更新*/

// InsertTrans 插入一条翻译记录，冲突时不更新任何字段
func InsertTrans(ctx context.Context, model *models.Translation) (err error) {
	return db.Clauses(clause.OnConflict{
		UpdateAll: false,
	}).Create(model).Error
}

func UpdateTrans(ctx context.Context, model *models.Translation) (err error) {
	return db.Updates(model).Error
}

func BatchInsert(ctx context.Context, models []*models.Translation) error {
	// 发生冲突时，只更新 updated_at 字段
	return db.Clauses(clause.OnConflict{
		DoUpdates: clause.AssignmentColumns([]string{"updated_at"}),
		UpdateAll: false,
	}).CreateInBatches(models, 100).Error
}

/*查询*/

func GetOne(ctx context.Context, hashCode string) (model *models.Translation, err error) {
	err = db.Where("hash = ?", hashCode).First(&model).Error
	if err != nil {
		return nil, err
	}
	return model, nil
}

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
	return models, db.Where("translated = ?", false).Order("id").Find(&models).Error
}

// ListTrans 获取所有短语
func ListTrans(ctx context.Context) ([]*models.Translation, error) {
	var models []*models.Translation
	return models, db.Order("id").Find(&models).Error
}
