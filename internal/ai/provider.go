package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Provider defines the interface for AI intelligence.
type Provider interface {
	ExplainSignature(ctx context.Context, header string, value string, codeSnippet string) (string, error)
	ContextualizeFlow(ctx context.Context, method, url, body string) (string, error)
}

// OpenAIProvider implements the Provider interface using OpenAI's API.
type OpenAIProvider struct {
	apiKey string
	model  string
}

func NewOpenAIProvider(apiKey string) *OpenAIProvider {
	return &OpenAIProvider{
		apiKey: apiKey,
		model:  "gpt-4-turbo-preview",
	}
}

func (p *OpenAIProvider) ContextualizeFlow(ctx context.Context, method, url, body string) (string, error) {
	if p.apiKey == "" {
		return "", fmt.Errorf("AI provider not configured")
	}

	prompt := fmt.Sprintf("Analyze this HTTP request and explain its likely purpose in a mobile app context:\nMethod: %s\nURL: %s\nBody: %s", method, url, body)
	
	return p.callOpenAI(ctx, prompt)
}

func (p *OpenAIProvider) ExplainSignature(ctx context.Context, header, value, code string) (string, error) {
	prompt := fmt.Sprintf("Explain how this request signature is likely calculated based on the header name and decompiled code snippet:\nHeader: %s\nValue: %s\nCode:\n%s", header, value, code)
	return p.callOpenAI(ctx, prompt)
}

func (p *OpenAIProvider) callOpenAI(ctx context.Context, prompt string) (string, error) {
	url := "https://api.openai.com/v1/chat/completions"
	
	reqBody, _ := json.Marshal(map[string]interface{}{
		"model": p.model,
		"messages": []map[string]string{
			{"role": "system", "content": "You are a senior mobile reverse engineer and security auditor."},
			{"role": "user", "content": prompt},
		},
	})

	req, _ := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("openai error: status %d", resp.StatusCode)
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	if len(result.Choices) > 0 {
		return result.Choices[0].Message.Content, nil
	}
	return "", fmt.Errorf("no response from AI")
}
