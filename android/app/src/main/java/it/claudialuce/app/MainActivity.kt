package it.claudialuce.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLConnection

/**
 * Claudia Luce: l'interfaccia è la stessa pagina della versione web
 * (assets/www/index.html), servita in locale. Qui ci sono solo i servizi
 * del telefono: scelta di file e fotocamera, lettura del testo dalle foto
 * (ML Kit, sul dispositivo) e condivisione dei file creati dall'app.
 *
 * Aggiornamento da solo: a ogni apertura l'app controlla se sul sito c'è una
 * versione più nuova della pagina e la scarica; dalla volta dopo usa quella.
 * La pagina resta servita dallo stesso indirizzo interno, quindi clienti e
 * dati salvati non cambiano. Senza internet usa l'ultima versione scaricata
 * o quella inclusa nell'app.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private val recognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
    private val cartellaWeb by lazy { File(filesDir, "web") }
    @Volatile private var paginaScaricata: File? = null
    @Volatile private var aggiornamentoPronto = false
    private var inSottofondoDal = 0L

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        var uris: Array<Uri>? = null
        if (res.resultCode == Activity.RESULT_OK) {
            val clip = res.data?.clipData
            uris = if (clip != null && clip.itemCount > 0) {
                Array(clip.itemCount) { clip.getItemAt(it).uri }
            } else {
                WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data)
            }
            val cam = cameraUri
            if ((uris == null || uris.isEmpty()) && cam != null) {
                val f = cameraFile()
                if (f.exists() && f.length() > 0) uris = arrayOf(cam)
            }
        }
        cb.onReceiveValue(uris)
        cameraUri = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // contenuto a tutto schermo, con margini per barre di sistema e tastiera
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }

        val root = FrameLayout(this)
        root.setBackgroundColor(getColor(R.color.page_bg))
        web = WebView(this)
        web.setBackgroundColor(getColor(R.color.page_bg))
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        paginaScaricata = preparaVersione()
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", PaginaAggiornabile())
            .build()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            setSupportZoom(false)
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val url = request?.url ?: return null
                return loader.shouldInterceptRequest(url)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (url.host == ASSET_HOST) return false
                // i link esterni (siti dei fornitori, fonti) si aprono nel browser
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (e: ActivityNotFoundException) {
                    Toast.makeText(this@MainActivity, "Nessuna app per aprire il link", Toast.LENGTH_SHORT).show()
                }
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                if (filePathCallback == null || fileChooserParams == null) return false
                fileCallback?.onReceiveValue(null)
                fileCallback = filePathCallback
                val wantsImage = fileChooserParams.acceptTypes.orEmpty().any { it != null && it.contains("image") }
                val pick = fileChooserParams.createIntent().apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    if (fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    }
                }
                val chooser = Intent.createChooser(pick, "Scegli il file")
                if (wantsImage) {
                    try {
                        val f = cameraFile()
                        f.parentFile?.mkdirs()
                        if (f.exists()) f.delete()
                        val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                        cameraUri = uri
                        val cam = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                            putExtra(MediaStore.EXTRA_OUTPUT, uri)
                            clipData = ClipData.newRawUri("foto", uri)
                            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(cam))
                    } catch (e: Exception) {
                        cameraUri = null
                    }
                }
                return try {
                    pickFiles.launch(chooser)
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    filePathCallback.onReceiveValue(null)
                    false
                }
            }
        }

        web.addJavascriptInterface(Bridge(), "ClaudiaAndroid")
        // i dati (clienti, prezzi scaricati) stanno nella memoria locale della pagina
        web.loadUrl("https://$ASSET_HOST/assets/www/index.html")
        controllaAggiornamento()
    }

    override fun onStop() {
        super.onStop()
        inSottofondoDal = System.currentTimeMillis()
    }

    override fun onResume() {
        super.onResume()
        // se nel frattempo è arrivata una versione nuova e l'app è rimasta chiusa
        // per un po', la carico adesso (i dati sono già salvati nella pagina)
        if (aggiornamentoPronto && inSottofondoDal > 0 && System.currentTimeMillis() - inSottofondoDal > 10 * 60 * 1000L) {
            aggiornamentoPronto = false
            paginaScaricata = preparaVersione()
            web.reload()
        }
    }

    /* ---------- aggiornamento della pagina senza reinstallare l'app ---------- */

    private fun versioneInclusa(): String = try {
        assets.open("www/versione.txt").bufferedReader().use { it.readText().trim() }
    } catch (e: Exception) { "" }

    /** Cartella dell'ultima versione scaricata, se valida; pulisce quelle vecchie. */
    private fun preparaVersione(): File? {
        try {
            cartellaWeb.mkdirs()
            // app reinstallata con una pagina diversa inclusa: riparto da quella
            val segno = File(cartellaWeb, "inclusa.txt")
            val inclusa = versioneInclusa()
            if (!segno.isFile || segno.readText().trim() != inclusa) {
                cartellaWeb.listFiles()?.forEach { it.deleteRecursively() }
                cartellaWeb.mkdirs()
                segno.writeText(inclusa)
                return null
            }
            val v = File(cartellaWeb, "attiva.txt").takeIf { it.isFile }?.readText()?.trim().orEmpty()
            val d = if (v.isNotEmpty()) File(cartellaWeb, v) else null
            val ok = d != null && File(d, "www/index.html").isFile
            cartellaWeb.listFiles()?.forEach {
                if (it.isDirectory && (!ok || it.name != v)) it.deleteRecursively()
            }
            return if (ok) d else null
        } catch (e: Exception) {
            return null
        }
    }

    private fun scarica(indirizzo: String): ByteArray {
        val c = URL(indirizzo).openConnection() as HttpURLConnection
        c.connectTimeout = 15000
        c.readTimeout = 30000
        c.useCaches = false
        try {
            if (c.responseCode != 200) throw IOException("http " + c.responseCode)
            return c.inputStream.use { it.readBytes() }
        } finally {
            c.disconnect()
        }
    }

    private fun controllaAggiornamento() {
        Thread {
            try {
                val info = JSONObject(String(scarica(SITO + "versione.json?t=" + System.currentTimeMillis()), Charsets.UTF_8))
                val v = info.getString("versione")
                if (!v.matches(Regex("[A-Za-z0-9._-]{4,60}"))) return@Thread
                if (BuildConfig.VERSION_CODE < info.optInt("minApk", 0)) return@Thread
                val attiva = File(cartellaWeb, "attiva.txt").takeIf { it.isFile }?.readText()?.trim().orEmpty()
                val corrente = attiva.ifEmpty { versioneInclusa() }
                if (v == corrente) return@Thread
                if (v == versioneInclusa()) {
                    File(cartellaWeb, "attiva.txt").delete()
                    aggiornamentoPronto = true
                    return@Thread
                }
                val tmp = File(cartellaWeb, "$v.parziale")
                tmp.deleteRecursively()
                val file = info.getJSONArray("file")
                for (i in 0 until file.length()) {
                    val nome = file.getString(i)
                    if (!nome.matches(Regex("[A-Za-z0-9._/-]{1,80}")) || nome.contains("..")) return@Thread
                    val dati = scarica(SITO + nome + "?v=" + v)
                    if (dati.isEmpty()) return@Thread
                    val f = File(tmp, "www/$nome")
                    f.parentFile?.mkdirs()
                    f.writeBytes(dati)
                }
                val indice = File(tmp, "www/index.html")
                if (!indice.isFile || !indice.readText().contains("</html>")) {
                    tmp.deleteRecursively()
                    return@Thread
                }
                val finale = File(cartellaWeb, v)
                finale.deleteRecursively()
                if (!tmp.renameTo(finale)) return@Thread
                File(cartellaWeb, "attiva.txt").writeText(v)
                aggiornamentoPronto = true
            } catch (e: Exception) {
                // senza internet o sito non raggiungibile: riprovo alla prossima apertura
            }
        }.start()
    }

    /** Serve la pagina scaricata, se c'è; tutto il resto (librerie, caratteri) dall'app. */
    private inner class PaginaAggiornabile : WebViewAssetLoader.PathHandler {
        private val inclusi = WebViewAssetLoader.AssetsPathHandler(this@MainActivity)
        override fun handle(path: String): WebResourceResponse? {
            val d = paginaScaricata
            if (d != null) {
                try {
                    val f = File(d, path)
                    if (f.isFile && f.canonicalPath.startsWith(d.canonicalPath + File.separator)) {
                        val tipo = when (f.extension.lowercase()) {
                            "html" -> "text/html"
                            "js" -> "text/javascript"
                            "css" -> "text/css"
                            "json" -> "application/json"
                            else -> URLConnection.guessContentTypeFromName(f.name) ?: "application/octet-stream"
                        }
                        val testo = tipo.startsWith("text/") || tipo == "application/json"
                        return WebResourceResponse(tipo, if (testo) "utf-8" else null, FileInputStream(f))
                    }
                } catch (e: Exception) {
                    // in caso di problemi uso la copia inclusa nell'app
                }
            }
            return inclusi.handle(path)
        }
    }

    private fun cameraFile() = File(File(cacheDir, "camera"), "bolletta.jpg")

    private fun reply(id: String, text: String?, err: String?) {
        val js = "window.__ocrDone(" + JSONObject.quote(id) + "," +
            (if (text == null) "null" else JSONObject.quote(text)) + "," +
            (if (err == null) "null" else JSONObject.quote(err)) + ")"
        runOnUiThread { web.evaluateJavascript(js, null) }
    }

    /** Servizi del telefono chiamati dalla pagina come window.ClaudiaAndroid */
    inner class Bridge {
        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun dataUrl(): String = BuildConfig.DATA_URL

        /** Riconosce il testo di una foto (JPEG in base64) e risponde con window.__ocrDone(id, testo, errore). */
        @JavascriptInterface
        fun ocr(base64: String, id: String) {
            try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (bmp == null) {
                    reply(id, null, "immagine non valida")
                    return
                }
                recognizer.process(InputImage.fromBitmap(bmp, 0))
                    .addOnSuccessListener { reply(id, it.text, null) }
                    .addOnFailureListener { reply(id, null, it.message ?: "errore di lettura") }
            } catch (e: Exception) {
                reply(id, null, e.message ?: "errore di lettura")
            }
        }

        /** Salva un file creato dalla pagina e apre il menu Condividi (WhatsApp, email, File, Drive…). */
        @JavascriptInterface
        fun saveFile(name: String, mime: String, base64: String) {
            runOnUiThread {
                try {
                    val dir = File(cacheDir, "shared").apply { mkdirs() }
                    val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
                    val f = File(dir, safe)
                    f.writeBytes(Base64.decode(base64, Base64.DEFAULT))
                    val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = mime
                        putExtra(Intent.EXTRA_STREAM, uri)
                        putExtra(Intent.EXTRA_SUBJECT, safe)
                        clipData = ClipData.newRawUri(safe, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(send, "Invia o salva $safe"))
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Non riesco a salvare il file", Toast.LENGTH_LONG).show()
                }
            }
        }

        /**
         * Scheda Proposta, «Condividi il PDF»: allega il PDF al messaggio già scritto
         * per il cliente e apre il menu Condividi (WhatsApp, Telegram, email…).
         */
        @JavascriptInterface
        fun shareFile(name: String, mime: String, base64: String, text: String?) {
            runOnUiThread {
                try {
                    val dir = File(cacheDir, "shared").apply { mkdirs() }
                    val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
                    val f = File(dir, safe)
                    f.writeBytes(Base64.decode(base64, Base64.DEFAULT))
                    val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.files", f)
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = mime
                        putExtra(Intent.EXTRA_STREAM, uri)
                        putExtra(Intent.EXTRA_SUBJECT, "Proposta fornitura luce")
                        if (!text.isNullOrBlank()) putExtra(Intent.EXTRA_TEXT, text)
                        clipData = ClipData.newRawUri(safe, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(send, "Invia la proposta"))
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "Non riesco a condividere il PDF: scaricalo e allegalo al messaggio", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    companion object {
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val SITO = "https://australia271.github.io/claudia-luce/"
    }
}
