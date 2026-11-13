package main
import ("os";"sort";"strings";"testing";"fmt")
func TestZZDump(t *testing.T) {
	raw, _ := os.ReadFile(os.Getenv("F")); m, err := parseDescriptorGroups(raw); if err != nil { t.Fatal(err) }
	ks := []string{}; for k := range m { ks = append(ks, k) }; sort.Strings(ks)
	for _, k := range ks { if strings.Contains(os.Getenv("Q"), "*") || strings.Contains(k, os.Getenv("Q")) { fmt.Println(k, m[k]) } }
}
