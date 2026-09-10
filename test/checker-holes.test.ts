import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject } from '../src/project.ts'
import { checkPath, executePath } from '../src/zee.ts'

const temps: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zee-9d-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function project(): string {
  return createProject({ name: 'app', parentDir: scratch(), mode: 'new' }).root
}

function write(root: string, rel: string, source: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, source)
}

describe('checker holes §9d (ZEE-7)', () => {
  it('allows an imported type on a field, parameter, and return', () => {
    const root = project()
    write(
      root,
      'src/users/users.service.zee',
      `pub class UserService {
  pub const name: String
}
`,
    )
    write(
      root,
      'src/web/users.controller.zee',
      `import users.UserService

pub class UsersController {
  pub const service: UserService
}

pub fn wrap(service: UserService) -> UserService {
  service
}
`,
    )
    write(
      root,
      'src/main.zee',
      `import web.UsersController
import web.wrap
import users.UserService

fn main() {
  const svc = UserService { name: "users" }
  const ctrl = UsersController { service: svc }
  println(wrap(ctrl.service).name)
}
`,
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('users\n')
  })

  it('imports a pub var by name from another module', () => {
    const root = project()
    write(
      root,
      'src/users/users.service.zee',
      `pub class UserService {
  pub const name: String
}

pub var usersService = UserService { name: "users" }
`,
    )
    write(
      root,
      'src/main.zee',
      `import users.usersService

fn main() {
  println(usersService.name)
}
`,
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('users\n')
  })

  it('lets two types in the same module share a method name', () => {
    const root = project()
    write(
      root,
      'src/users/users.service.zee',
      `pub class UserService {
  pub const name: String

  pub fn create(self) -> String {
    self.name
  }
}

pub class UsersController {
  pub const name: String

  pub fn create(self) -> String {
    self.name
  }
}
`,
    )
    write(
      root,
      'src/main.zee',
      `import users.UserService
import users.UsersController

fn main() {
  println(UserService { name: "svc" }.create())
  println(UsersController { name: "ctrl" }.create())
}
`,
    )
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('svc\nctrl\n')
  })

  it('still type-checks a generate-shaped slice that wires controller to service', () => {
    const root = project()
    write(
      root,
      'src/users/users.service.zee',
      `pub class UserService {
  pub const name: String

  pub fn empty() -> self {
    self { name: "users" }
  }

  pub fn create(self) -> String {
    self.name
  }
}

pub var usersService = UserService.empty()
`,
    )
    write(
      root,
      'src/users/users.controller.zee',
      `pub class UsersController {
  pub const service: UserService

  pub fn create(self) -> String {
    self.service.create()
  }
}
`,
    )
    write(
      root,
      'src/main.zee',
      `import users.UsersController
import users.usersService

fn main() {
  const users = UsersController { service: usersService }
  println(users.create())
}
`,
    )
    expect(() => checkPath(join(root, 'src/main.zee'))).not.toThrow()
    expect(executePath(join(root, 'src/main.zee')).stdout).toBe('users\n')
  })
})
