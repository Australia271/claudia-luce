plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val dataUrl = (project.findProperty("claudiaDataUrl") as String?)?.trim().orEmpty()
// Firma stabile per gli aggiornamenti: se esistono queste variabili d'ambiente
// (per esempio nella compilazione automatica su GitHub) si usa la chiave indicata,
// altrimenti la chiave di debug del computer che compila.
val ksPath: String? = System.getenv("CL_KEYSTORE")

android {
    namespace = "it.claudialuce.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "it.claudialuce.app"
        minSdk = 26
        targetSdk = 35
        // ogni compilazione su GitHub ha un numero più alto, così il telefono accetta l'aggiornamento
        val run = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionCode = run
        versionName = "1.0.$run"
        buildConfigField("String", "DATA_URL", "\"$dataUrl\"")
    }

    signingConfigs {
        if (ksPath != null && file(ksPath).exists()) {
            create("stable") {
                storeFile = file(ksPath)
                storePassword = System.getenv("CL_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("CL_KEY_ALIAS")
                keyPassword = System.getenv("CL_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("stable") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    // riconoscimento del testo sul telefono, modello incluso nell'app (funziona offline)
    implementation("com.google.mlkit:text-recognition:16.0.1")
}
