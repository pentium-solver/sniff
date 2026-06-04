package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/xlock-dev/sniff/internal/logger"
)

type contextKey string

const (
	userContextKey contextKey = "user"
)

// AuthMiddleware handles JWT validation for the API.
func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// If auth is disabled in config, pass through
		if !s.config.AuthEnabled {
			next.ServeHTTP(w, r)
			return
		}

		// Check for token in Authorization header or Query param (for SSE)
		tokenStr := r.Header.Get("Authorization")
		if strings.HasPrefix(tokenStr, "Bearer ") {
			tokenStr = strings.TrimPrefix(tokenStr, "Bearer ")
		} else {
			tokenStr = r.URL.Query().Get("token")
		}

		if tokenStr == "" {
			http.Error(w, "Unauthorized: missing token", http.StatusUnauthorized)
			return
		}

		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}
			return []byte(s.config.APISecret), nil
		})

		if err != nil || !token.Valid {
			logger.Warn("Invalid auth token attempt", "error", err)
			http.Error(w, "Unauthorized: invalid token", http.StatusUnauthorized)
			return
		}

		// Extract claims (e.g., username) and put in context
		if claims, ok := token.Claims.(jwt.MapClaims); ok {
			ctx := context.WithValue(r.Context(), userContextKey, claims["sub"])
			next.ServeHTTP(w, r.WithContext(ctx))
		} else {
			next.ServeHTTP(w, r)
		}
	})
}

// GenerateToken creates a new JWT for the specified user.
func (s *Server) GenerateToken(user string) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": user,
		"exp": time.Now().Add(time.Hour * 24 * 7).Unix(), // 7 days
		"iat": time.Now().Unix(),
	})

	return token.SignedString([]byte(s.config.APISecret))
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Simple shared-secret login for now
	if req.Secret != s.config.APISecret {
		http.Error(w, "Invalid secret", http.StatusUnauthorized)
		return
	}

	token, err := s.GenerateToken("admin")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"token": token,
	})
}
