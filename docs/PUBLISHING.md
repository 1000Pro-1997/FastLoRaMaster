# Publishing

이 프로젝트에서 사용자가 **“시빌 업해줘”**라고 말하면 **Comfy Registry 배포**를 뜻한다.

## 배포 절차

1. `pyproject.toml`의 버전을 올린다.
2. Python·JavaScript 구문 검사와 `git diff --check`를 실행한다.
3. `comfy node validate`로 Registry 게시 설정과 보안 검사를 통과시킨다.
4. 변경 사항과 버전 변경을 커밋하고 `main` 및 버전 태그를 GitHub에 푸시한다.
5. 프로젝트 `.env`의 `COMFY_REGISTRY_TOKEN`을 출력하지 않고 메모리로 읽는다.
6. 해당 토큰과 변경 내역을 전달해 `comfy node publish`를 실행한다.
7. `Upload successful`과 최종 검증 통과를 확인한다.

Windows에서 CLI가 실행되지 않으면 설치 위치를 확인해 해당 실행 파일을 사용한다.

```powershell
Get-Command comfy -ErrorAction SilentlyContinue
py -m pip show comfy-cli
```

토큰 값은 로그, 문서, 커밋 또는 명령 문자열에 직접 기록하지 않는다.
