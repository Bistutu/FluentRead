package log

import (
	"go.uber.org/zap"
)

var logger *zap.SugaredLogger

func init() {
	baseLogger, _ := zap.NewDevelopment()
	logger = baseLogger.Sugar()
}

// Info logs a non-formatted info message.
func Info(args ...interface{}) {
	logger.Info(args...)
}

// Infof logs an info message with formatting.
func Infof(template string, args ...interface{}) {
	logger.Infof(template, args...)
}

// Infow logs an info message with named fields.
func Infow(msg string, keysAndValues ...interface{}) {
	logger.Infow(msg, keysAndValues...)
}

// Debug logs a non-formatted debug message.
func Debug(args ...interface{}) {
	logger.Debug(args...)
}

// Debugf logs a debug message with formatting.
func Debugf(template string, args ...interface{}) {
	logger.Debugf(template, args...)
}

// Debugw logs a debug message with named fields.
func Debugw(msg string, keysAndValues ...interface{}) {
	logger.Debugw(msg, keysAndValues...)
}

// Warn logs a non-formatted warning message.
func Warn(args ...interface{}) {
	logger.Warn(args...)
}

// Warnf logs a warning message with formatting.
func Warnf(template string, args ...interface{}) {
	logger.Warnf(template, args...)
}

// Warnw logs a warning message with named fields.
func Warnw(msg string, keysAndValues ...interface{}) {
	logger.Warnw(msg, keysAndValues...)
}

// Error logs a non-formatted error message.
func Error(args ...interface{}) {
	logger.Error(args...)
}

// Errorf logs an error message with formatting.
func Errorf(template string, args ...interface{}) {
	logger.Errorf(template, args...)
}

// Errorw logs an error message with named fields.
func Errorw(msg string, keysAndValues ...interface{}) {
	logger.Errorw(msg, keysAndValues...)
}
