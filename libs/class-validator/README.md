# class-validator

Official Zee field rules. The language stores `@Name` as metadata and exposes it with `fields()`. **This package** decides what those names do.

Zee import is `classValidator` — `class` is a keyword and `-` is not an ident.

```zee
import classValidator
import classValidator.Issue

pub data struct StoreUser {
  @NotBlank
  @MinLength(1)
  pub const name: String
}

fn run(body: StoreUser) {
  const issues = classValidator.validate(body)
  if !issues.isEmpty() {
    const hit = issues.first() ?: Issue { field: "", rule: "", text: "" }
    println(hit.text)
  }
}
```

`classValidator.validate(value) -> List<Issue>`. Empty list is valid. Zee has no `throw` — you branch on the list. `validateSync` is the same function. HTTP handlers use `@Valid` on the method (http overlay calls `validate`; every issue is `422` JSON `{"issues":[{field, rule, text}, …]}`).

Typestack names work. Zee extras keep the names already used in apps.

| Attribute | Action |
|---|---|
| `@IsNotEmpty` | string is not `""` (spaces pass) |
| `@NotBlank` | string is not Unicode blank |
| `@MinLength(n)` / `@MaxLength(n)` / `@Length(min, max)` | character length |
| `@Min(n)` / `@Max(n)` | integer bounds |
| `@IsPositive` / `@IsNegative` / `@IsDivisibleBy(n)` | integer |
| `@IsEmail` / `@Email` | `local@host.tld` |
| `@Matches("regex")` / `@Pattern("regex")` | unanchored Unicode (`Regex.isMatch`) |
| `@Contains("seed")` / `@NotContains("seed")` | substring |
| `@Equals("x")` / `@NotEquals("x")` | string or integer |
| `@IsIn("a,b")` / `@IsNotIn("a,b")` | comma-separated (Zee has no array attr args) |
| `@IsUppercase` / `@IsLowercase` / `@IsAlpha` / `@IsAlphanumeric` | letters |
| `@IsUUID` | UUID string |
| `@ConfirmPassword("password")` | this string equals sibling field |
| `@IsOptional` | skip other rules on this field when the string is empty |

Unknown names stay metadata. Nested structs, groups, promises, `validateOrReject`, and validator.js locale catalogs are a later cut.

This package is Zee. The language does not implement the rules.
