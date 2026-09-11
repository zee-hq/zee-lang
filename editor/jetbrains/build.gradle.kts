plugins {
    kotlin("jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.5.0"
}

group = "dev.zee"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

dependencies {
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
        plugin("com.redhat.devtools.lsp4ij:0.8.1")
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "dev.zee.lang"
        name = "Zee"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "243"
        }
    }
    publishing {
        token = providers.environmentVariable("JETBRAINS_MARKETPLACE_TOKEN")
    }
}
