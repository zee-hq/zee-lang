package dev.zee.lang

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.project.Project
import com.redhat.devtools.lsp4ij.LanguageServerFactory
import com.redhat.devtools.lsp4ij.server.OSProcessStreamConnectionProvider
import com.redhat.devtools.lsp4ij.server.StreamConnectionProvider
import org.jetbrains.annotations.NotNull

class ZeeLanguageServerFactory : LanguageServerFactory {
    @NotNull
    override fun createConnectionProvider(@NotNull project: Project): StreamConnectionProvider {
        return ZeeLanguageServer()
    }
}

class ZeeLanguageServer : OSProcessStreamConnectionProvider() {
    init {
        setCommandLine(GeneralCommandLine("zee", "lsp"))
    }
}
