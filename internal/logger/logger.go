package logger

import (
	"context"
	"io"
	"log/slog"
	"os"
)

const (
	LevelDebug = slog.LevelDebug
	LevelInfo  = slog.LevelInfo
	LevelWarn  = slog.LevelWarn
	LevelError = slog.LevelError
)

var defaultLogger *slog.Logger

func init() {
	// Initialize with a simple text handler by default
	defaultLogger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
}

// Setup initializes the global logger with the desired level and output.
func Setup(level slog.Level, output io.Writer, json bool) {
	opts := &slog.HandlerOptions{
		Level: level,
	}

	var handler slog.Handler
	if json {
		handler = slog.NewJSONHandler(output, opts)
	} else {
		handler = slog.NewTextHandler(output, opts)
	}

	defaultLogger = slog.New(handler)
	slog.SetDefault(defaultLogger)
}

// Global functions for convenience
func Info(msg string, args ...any)    { defaultLogger.Info(msg, args...) }
func Error(msg string, args ...any)   { defaultLogger.Error(msg, args...) }
func Warn(msg string, args ...any)    { defaultLogger.Warn(msg, args...) }
func Debug(msg string, args ...any)   { defaultLogger.Debug(msg, args...) }

func InfoContext(ctx context.Context, msg string, args ...any)  { defaultLogger.InfoContext(ctx, msg, args...) }
func ErrorContext(ctx context.Context, msg string, args ...any) { defaultLogger.ErrorContext(ctx, msg, args...) }
func WarnContext(ctx context.Context, msg string, args ...any)  { defaultLogger.WarnContext(ctx, msg, args...) }
func DebugContext(ctx context.Context, msg string, args ...any) { defaultLogger.DebugContext(ctx, msg, args...) }

// With returns a new logger with the given attributes.
func With(args ...any) *slog.Logger {
	return defaultLogger.With(args...)
}
