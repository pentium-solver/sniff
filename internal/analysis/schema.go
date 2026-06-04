package analysis

import (
	"encoding/json"
	"reflect"
)

// FieldSchema represents the structure of a single JSON field.
type FieldSchema struct {
	Type     string                 `json:"type"`
	Nullable bool                   `json:"nullable"`
	Children map[string]*FieldSchema `json:"children,omitempty"` // For objects
	Items    *FieldSchema           `json:"items,omitempty"`    // For arrays
}

// InferSchema parses a JSON string and returns its structural schema.
func InferSchema(sample string) (*FieldSchema, error) {
	var val interface{}
	if err := json.Unmarshal([]byte(sample), &val); err != nil {
		return nil, err
	}
	return inferValue(val), nil
}

func inferValue(val interface{}) *FieldSchema {
	if val == nil {
		return &FieldSchema{Type: "null", Nullable: true}
	}

	s := &FieldSchema{}
	v := reflect.ValueOf(val)

	switch v.Kind() {
	case reflect.Map:
		s.Type = "object"
		s.Children = make(map[string]*FieldSchema)
		for _, key := range v.MapKeys() {
			s.Children[key.String()] = inferValue(v.MapIndex(key).Interface())
		}
	case reflect.Slice:
		s.Type = "array"
		if v.Len() > 0 {
			// Infer from the first item (simplification)
			s.Items = inferValue(v.Index(0).Interface())
		} else {
			s.Items = &FieldSchema{Type: "any"}
		}
	case reflect.String:
		s.Type = "string"
	case reflect.Float64:
		s.Type = "number"
	case reflect.Bool:
		s.Type = "boolean"
	default:
		s.Type = "unknown"
	}

	return s
}

// MergeSchemas combines two schemas, identifying optional fields and type unions.
func MergeSchemas(base, add *FieldSchema) *FieldSchema {
	if base == nil {
		return add
	}
	if add == nil {
		return base
	}

	if base.Type != add.Type {
		base.Type = "mixed"
	}

	if add.Nullable {
		base.Nullable = true
	}

	if base.Type == "object" && add.Children != nil {
		if base.Children == nil {
			base.Children = make(map[string]*FieldSchema)
		}
		for k, v := range add.Children {
			base.Children[k] = MergeSchemas(base.Children[k], v)
		}
		// Any keys in base NOT in add should be marked as optional (implied by presence)
	}

	if base.Type == "array" && add.Items != nil {
		base.Items = MergeSchemas(base.Items, add.Items)
	}

	return base
}
