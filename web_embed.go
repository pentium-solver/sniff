package main

import "embed"
import "io/fs"

//go:embed all:web
var webFS embed.FS

var webContent, _ = fs.Sub(webFS, "web")
